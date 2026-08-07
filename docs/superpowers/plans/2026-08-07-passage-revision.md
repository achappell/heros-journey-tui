# Passage Revision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the guided flow from destroying a session. Replace destructive `Reject` with revise-with-feedback and manual editing, keep every attempt as a version, and make in-flight state survive Escape and refresh.

**Architecture:** `guidedState` gains a `versions` array (each `{text, source, feedback}`) and a `versionIdx`; the single `suggestion` field is retired in favour of a `currentSuggestion()` helper so there is one source of truth. A new `AIClient.reviseAnswers()` reuses the existing `callChat`, inheriting provider dispatch and error handling. `StoryStore` gains guided-session persistence under a new `hj_guided_state` key so Escape can collapse without discarding, and reopening a stage offers Resume / Start over.

**Tech Stack:** Vanilla JS (no build step, no framework), `localStorage`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-07-passage-revision-design.md` — read it if anything here is ambiguous.
- **Client-side only.** No changes to `app.py`, `ai.py`, `tests/`, the Cloudflare Worker, or any provider wiring.
- No build tooling and no JS test runner — matching the existing static site. Pure logic is verified with a throwaway `node` harness; UI is verified manually in a browser against `python3 -m http.server 8765 --directory static`.
- **No single keystroke or click may destroy a session.** Escape collapses only; the sole discard path is `Start over…` behind a confirmation.
- `localStorage` key for in-flight sessions is exactly `hj_guided_state`, joining the existing `hj_story`, `hj_story_logs`, `hj_settings`, `hj_theme`.
- `version.source` is one of exactly `"generated"`, `"revised"`, `"manual"`.
- All persistence writes are best-effort: wrap in try/catch so a quota or private-mode failure degrades to in-memory rather than breaking the flow.
- Python tests must still pass (`.venv/bin/python -m pytest tests/ -q` → 18 passed) — they cover the Flask side and must not regress.

---

### Task 1: `AIClient.reviseAnswers()`

**Files:**
- Modify: `static/js/ai-client.js`

**Interfaces:**
- Consumes: existing `callChat(systemMsg, userMsg)` and `getAgeGuidance(ageRange)` in the same module.
- Produces: `AIClient.reviseAnswers(stagePrompt, storySoFar, qAndA, previousText, feedback) -> Promise<string>` — returns revised prose. Used by Task 4.

- [ ] **Step 1: Add the function next to `weaveAnswers`**

Insert immediately after the `weaveAnswers` function:

```javascript
  async function reviseAnswers(stagePrompt, storySoFar, qAndA, previousText, feedback) {
    const settings = Settings.load();
    let systemMsg =
      "You are an expert storyteller. You previously wrote a narrative passage for a stage of the user's Hero's Journey story, " +
      "and the user has asked for changes. " +
      "Revise the passage according to their feedback while preserving everything they did not ask you to change — " +
      "keep the same events, characters, and details unless the feedback calls for altering them. " +
      "Output only the revised narrative text, no extra commentary and no explanation of what you changed.";

    const guidance = await getAgeGuidance(settings.ageRange);
    if (guidance) systemMsg = `${guidance}\n\n${systemMsg}`;

    const qaText = qAndA.map((item) => `Q: ${item.q}\nA: ${item.a}`).join("\n");
    const userMsg =
      `Story so far:\n${storySoFar || "(Beginning of the story)"}\n\n` +
      `Stage context: ${stagePrompt}\n\n` +
      `User's Q&A:\n${qaText}\n\n` +
      `The passage you wrote:\n${previousText}\n\n` +
      `What the user wants changed:\n${feedback}`;

    return callChat(systemMsg, userMsg);
  }
```

- [ ] **Step 2: Export it**

Find:
```javascript
  return { generateQuestions, weaveAnswers };
```
Replace with:
```javascript
  return { generateQuestions, weaveAnswers, reviseAnswers };
```

- [ ] **Step 3: Verify syntax and prompt assembly**

Run: `node --check static/js/ai-client.js && echo "syntax OK"`
Expected: `syntax OK`

Then verify the user message includes both the previous passage and the feedback. Write `/tmp/revise-check.js`:

```javascript
const fs = require("fs");
const src = fs.readFileSync("static/js/ai-client.js", "utf8");
// Confirm the revise user message wires in both new inputs
const body = src.slice(src.indexOf("async function reviseAnswers"), src.indexOf("return { generateQuestions"));
const checks = [
  ["passes previous passage", body.includes("${previousText}")],
  ["passes feedback", body.includes("${feedback}")],
  ["reuses callChat", body.includes("return callChat(systemMsg, userMsg)")],
  ["applies age guidance", body.includes("getAgeGuidance")],
];
let bad = 0;
for (const [name, ok] of checks) { if (!ok) bad++; console.log(ok ? "PASS" : "FAIL", "-", name); }
process.exit(bad ? 1 : 0);
```

Run: `node /tmp/revise-check.js`
Expected: four `PASS` lines, exit 0.

- [ ] **Step 4: Commit**

```bash
git add static/js/ai-client.js
git commit -m "feat: add reviseAnswers for feedback-driven passage revision"
```

---

### Task 2: Guided-session persistence in `StoryStore`

**Files:**
- Modify: `static/js/story-store.js`

**Interfaces:**
- Produces, all added to the `StoryStore` return object:
  - `saveGuidedSession(stageKey, state) -> void` — persists one stage's in-flight session.
  - `loadGuidedSession(stageKey) -> object | null` — returns the stored session for that stage, or `null`.
  - `clearGuidedSession(stageKey) -> void` — removes that stage's session.
- Consumed by Tasks 3 and 5.

- [ ] **Step 1: Add the functions**

Add inside the `StoryStore` IIFE, before its `return` statement:

```javascript
  const GUIDED_KEY = "hj_guided_state";

  // In-flight guided sessions, keyed by stage. Every write is best-effort:
  // a storage failure must degrade to in-memory, never break the flow.
  function readGuidedAll() {
    try {
      return JSON.parse(localStorage.getItem(GUIDED_KEY) || "{}") || {};
    } catch (err) {
      return {};
    }
  }

  function saveGuidedSession(stageKey, state) {
    try {
      const all = readGuidedAll();
      all[stageKey] = state;
      localStorage.setItem(GUIDED_KEY, JSON.stringify(all));
    } catch (err) {
      /* quota or private mode — session stays in memory only */
    }
  }

  function loadGuidedSession(stageKey) {
    const all = readGuidedAll();
    return Object.prototype.hasOwnProperty.call(all, stageKey) ? all[stageKey] : null;
  }

  function clearGuidedSession(stageKey) {
    try {
      const all = readGuidedAll();
      delete all[stageKey];
      localStorage.setItem(GUIDED_KEY, JSON.stringify(all));
    } catch (err) {
      /* best-effort */
    }
  }
```

- [ ] **Step 2: Export them**

Find:
```javascript
  return { wordCount, stageStatus, load, save, saveStageContent, completedCount };
```
Replace with:
```javascript
  return {
    wordCount, stageStatus, load, save, saveStageContent, completedCount,
    saveGuidedSession, loadGuidedSession, clearGuidedSession,
  };
```

- [ ] **Step 3: Verify round-trip and failure tolerance**

Write `/tmp/guided-store-check.js`:

```javascript
const fs = require("fs");
// Minimal localStorage stub
let store = {};
global.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};
const src = fs.readFileSync("static/js/story-store.js", "utf8");
eval(src);

let fail = 0;
const t = (name, ok) => { if (!ok) fail++; console.log(ok ? "PASS" : "FAIL", "-", name); };

t("missing session returns null", StoryStore.loadGuidedSession("call") === null);

StoryStore.saveGuidedSession("call", { q_and_a: [{ q: "a", a: "b" }], versionIdx: 0 });
t("round-trips", JSON.stringify(StoryStore.loadGuidedSession("call").q_and_a) === JSON.stringify([{ q: "a", a: "b" }]));

StoryStore.saveGuidedSession("ordeal", { versionIdx: 2 });
t("keyed per stage", StoryStore.loadGuidedSession("ordeal").versionIdx === 2 && StoryStore.loadGuidedSession("call").versionIdx === 0);

StoryStore.clearGuidedSession("call");
t("clear removes only its own stage", StoryStore.loadGuidedSession("call") === null && StoryStore.loadGuidedSession("ordeal") !== null);

// corrupt payload must not throw
store["hj_guided_state"] = "{not json";
t("corrupt storage returns null, no throw", StoryStore.loadGuidedSession("call") === null);

// write failure must not throw
global.localStorage.setItem = () => { throw new Error("QuotaExceeded"); };
let threw = false;
try { StoryStore.saveGuidedSession("call", { a: 1 }); } catch (e) { threw = true; }
t("write failure is swallowed", !threw);

process.exit(fail ? 1 : 0);
```

Run: `node --check static/js/story-store.js && node /tmp/guided-store-check.js`
Expected: six `PASS` lines, exit 0.

- [ ] **Step 4: Commit**

```bash
git add static/js/story-store.js
git commit -m "feat: persist in-flight guided sessions per stage"
```

---

### Task 3: Version model in `guidedState`

**Files:**
- Modify: `static/app.js`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces:
  - `guidedState.versions: Array<{text: string, source: "generated"|"revised"|"manual", feedback: string|null}>`
  - `guidedState.versionIdx: number`
  - `currentSuggestion() -> string | null` — module-level helper, the single source of truth for the displayed passage. Used by Tasks 4 and 5.
  - `pushVersion(text, source, feedback) -> void` — appends and selects the new version.
- The `guidedState.suggestion` field is **removed**; every read is replaced with `currentSuggestion()`.

- [ ] **Step 1: Add the helpers**

Add just above `async function startGuidedFlow(key) {`:

```javascript
// The displayed passage always comes from the versions array — never store it
// separately, or the two copies drift.
function currentSuggestion() {
  if (!guidedState || !Array.isArray(guidedState.versions)) return null;
  const v = guidedState.versions[guidedState.versionIdx];
  return v ? v.text : null;
}

function pushVersion(text, source, feedback) {
  if (!guidedState) return;
  if (!Array.isArray(guidedState.versions)) guidedState.versions = [];
  guidedState.versions.push({ text, source, feedback: feedback || null });
  guidedState.versionIdx = guidedState.versions.length - 1;
}
```

- [ ] **Step 2: Replace the `suggestion` field at init**

In `startGuidedFlow`, find:
```javascript
    suggestion: null,
```
Replace with:
```javascript
    versions: [],
    versionIdx: 0,
```

- [ ] **Step 3: Make the weave push a version**

In `doWeave`, find:
```javascript
    guidedState.suggestion = suggestion;
```
Replace with:
```javascript
    pushVersion(suggestion, "generated", null);
```

- [ ] **Step 4: Replace the three remaining `suggestion` reads**

There are exactly three. Replace each:

In the render branch, find `} else if (guidedState.suggestion) {` and replace with:
```javascript
        } else if (currentSuggestion()) {
```

In the same branch's markup, find `${escapeHtml(guidedState.suggestion)}` and replace with:
```javascript
${escapeHtml(currentSuggestion())}
```

In the Accept handler, find `const content = guidedState.suggestion;` and replace with:
```javascript
          const content = currentSuggestion();
```

In the focus-textarea condition near the end of `render()`, find `&& !guidedState.suggestion) {` and replace with:
```javascript
 && !currentSuggestion()) {
```

- [ ] **Step 5: Record versions in the session log**

In the Accept handler, find:
```javascript
            final_woven_content: content
```
Replace with:
```javascript
            final_woven_content: content,
            versions: guidedState.versions,
            accepted_version_index: guidedState.versionIdx
```

- [ ] **Step 6: Verify nothing still reads the removed field**

Run:
```bash
node --check static/app.js && echo "syntax OK"
grep -n "guidedState.suggestion" static/app.js || echo "no stale reads — good"
```
Expected: `syntax OK`, then `no stale reads — good`.

- [ ] **Step 7: Verify in the browser (no regression yet)**

Start `python3 -m http.server 8765 --directory static`, open `http://localhost:8765`, run a guided flow to a generated passage. It must behave exactly as before — passage shows, Accept writes it to the stage. This task is a refactor; visible behaviour is unchanged.

- [ ] **Step 8: Commit**

```bash
git add static/app.js
git commit -m "refactor: model the guided passage as a version list"
```

---

### Task 4: Preview UI — Revise, Edit myself, version stepper

**Files:**
- Modify: `static/app.js`
- Modify: `static/style.css`

**Interfaces:**
- Consumes: `AIClient.reviseAnswers(...)` (Task 1); `currentSuggestion()`, `pushVersion()`, `guidedState.versions`, `guidedState.versionIdx` (Task 3).
- Produces: `guidedState.uiMode: "preview" | "revising" | "editing"` — drives which preview sub-view renders. Used by Task 5's resume rendering.

- [ ] **Step 1: Initialise the UI mode**

In `startGuidedFlow`, directly after the `versionIdx: 0,` line added in Task 3, add:
```javascript
    uiMode: "preview",
```

- [ ] **Step 2: Replace the preview markup**

Find the whole `} else if (currentSuggestion()) {` branch body and replace the `bodyHtml = ...` assignment with:

```javascript
          const versionCount = guidedState.versions.length;
          const stepper = versionCount > 1
            ? `<div class="version-stepper">
                 <button class="version-nav prev" ${guidedState.versionIdx === 0 ? "disabled" : ""}>‹</button>
                 <span class="version-label">v${guidedState.versionIdx + 1} of ${versionCount}</span>
                 <button class="version-nav next" ${guidedState.versionIdx === versionCount - 1 ? "disabled" : ""}>›</button>
               </div>`
            : "";

          if (guidedState.uiMode === "editing") {
            bodyHtml = `
              <div class="guided-flow">
                <div class="preview-block">
                  <textarea class="manual-edit-area">${escapeHtml(currentSuggestion())}</textarea>
                  <div class="preview-actions">
                    <button class="action-btn save-edit">Save</button>
                    <button class="action-btn cancel-edit">Cancel</button>
                  </div>
                </div>
              </div>
            `;
          } else if (guidedState.uiMode === "revising") {
            bodyHtml = `
              <div class="guided-flow">
                <div class="preview-block">
                  <div class="preview-text">${escapeHtml(currentSuggestion())}</div>
                  <label class="revise-label">What should change?</label>
                  <textarea class="revise-feedback" placeholder="e.g. too formal — she's 8"></textarea>
                  <div class="preview-actions">
                    <button class="action-btn regenerate">Regenerate</button>
                    <button class="action-btn cancel-revise">Cancel</button>
                  </div>
                </div>
              </div>
            `;
          } else {
            bodyHtml = `
              <div class="guided-flow">
                <div class="preview-block">
                  <div class="preview-text">${escapeHtml(currentSuggestion())}</div>
                  ${stepper}
                  <div class="preview-actions">
                    <button class="action-btn accept">Accept</button>
                    <button class="action-btn revise">Revise…</button>
                    <button class="action-btn edit-manual">Edit myself</button>
                  </div>
                </div>
              </div>
            `;
          }
```

- [ ] **Step 3: Replace the Reject handler with the new handlers**

Find the existing reject handler:
```javascript
      const rejectBtn = el.querySelector(".reject");
      if (rejectBtn) {
        rejectBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          guidedState = null;
          guidedGeneration++;
          render();
        });
      }
```

Replace it entirely with:

```javascript
      const reviseBtn = el.querySelector(".revise");
      if (reviseBtn) {
        reviseBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          guidedState.uiMode = "revising";
          render();
        });
      }

      const cancelReviseBtn = el.querySelector(".cancel-revise");
      if (cancelReviseBtn) {
        cancelReviseBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          guidedState.uiMode = "preview";
          render();
        });
      }

      const regenerateBtn = el.querySelector(".regenerate");
      if (regenerateBtn) {
        regenerateBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          const feedback = el.querySelector(".revise-feedback").value.trim();
          if (!feedback) return;
          const generation = guidedGeneration;
          const previousText = currentSuggestion();
          guidedState.uiMode = "preview";
          guidedState.loading = true;
          render();
          const stage = stages.find((st) => st.key === s.key);
          const storySoFar = getStorySoFar(s.key);
          try {
            const revised = await AIClient.reviseAnswers(
              stage.prompt, storySoFar, guidedState.q_and_a, previousText, feedback
            );
            if (generation !== guidedGeneration) return;
            pushVersion(revised, "revised", feedback);
          } catch (err) {
            if (generation !== guidedGeneration) return;
            // A failed revision must never cost an existing draft.
            guidedState.error = err.message || "Revision failed";
          } finally {
            if (generation === guidedGeneration && guidedState) {
              guidedState.loading = false;
              persistGuidedSession();
              render();
            }
          }
        });
      }

      const editManualBtn = el.querySelector(".edit-manual");
      if (editManualBtn) {
        editManualBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          guidedState.uiMode = "editing";
          render();
        });
      }

      const saveEditBtn = el.querySelector(".save-edit");
      if (saveEditBtn) {
        saveEditBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const edited = el.querySelector(".manual-edit-area").value.trim();
          if (edited && edited !== currentSuggestion()) {
            pushVersion(edited, "manual", null);
          }
          guidedState.uiMode = "preview";
          persistGuidedSession();
          render();
        });
      }

      const cancelEditBtn = el.querySelector(".cancel-edit");
      if (cancelEditBtn) {
        cancelEditBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          guidedState.uiMode = "preview";
          render();
        });
      }

      el.querySelectorAll(".version-nav").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const delta = btn.classList.contains("next") ? 1 : -1;
          const next = guidedState.versionIdx + delta;
          if (next < 0 || next >= guidedState.versions.length) return;
          guidedState.versionIdx = next;
          persistGuidedSession();
          render();
        });
      });
```

**Note:** `persistGuidedSession()` is defined in Task 5. If Task 5 has not been implemented yet, add this temporary no-op above `currentSuggestion()` so this task runs standalone, and delete it when Task 5 lands:

```javascript
function persistGuidedSession() { /* implemented in Task 5 */ }
```

- [ ] **Step 4: Add the styles**

Append to `static/style.css`:

```css
.action-btn.revise, .action-btn.edit-manual,
.action-btn.regenerate, .action-btn.save-edit {
  background: var(--accent);
  color: #fff;
}
.action-btn.cancel-revise, .action-btn.cancel-edit {
  background: transparent;
  color: var(--text-secondary);
}

.version-stepper {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.6rem;
  margin: 0.4rem 0;
}
.version-label { font-size: 0.7rem; color: var(--text-secondary); }
.version-nav {
  background: transparent;
  border: 1px solid var(--text-secondary);
  color: var(--text-secondary);
  border-radius: 4px;
  cursor: pointer;
  padding: 0 0.4rem;
  line-height: 1.4;
}
.version-nav:disabled { opacity: 0.3; cursor: default; }

.revise-label {
  display: block;
  font-size: 0.7rem;
  color: var(--text-secondary);
  margin-top: 0.5rem;
}
.revise-feedback, .manual-edit-area {
  width: 100%;
  box-sizing: border-box;
  margin-top: 0.3rem;
  padding: 0.4rem;
  font: inherit;
  color: var(--text-primary);
  background: var(--bg-card);
  border: 1px solid var(--text-secondary);
  border-radius: 4px;
  resize: vertical;
}
.revise-feedback { min-height: 3rem; }
.manual-edit-area { min-height: 8rem; }
```

- [ ] **Step 5: Verify syntax**

Run: `node --check static/app.js && echo "js OK"`
Expected: `js OK`

- [ ] **Step 6: Verify in the browser**

With the static server running and a real provider key set, run a guided flow to a passage, then:
1. **Revise…** → type "make it shorter and more playful" → **Regenerate**. A new passage appears and the stepper reads `v2 of 2`.
2. Click `‹` — v1 returns; `›` — back to v2.
3. Step to v1 and click **Accept** — v1's text (not v2's) is written to the stage.
4. Re-run a flow, click **Edit myself**, change a word, **Save** — stepper increments and shows your edit.
5. **Edit myself** → **Cancel** — no new version is created.
6. Set an invalid key, hit **Regenerate** — an error shows and the existing versions are still reachable.

- [ ] **Step 7: Commit**

```bash
git add static/app.js static/style.css
git commit -m "feat: revise with feedback, manual edit, and version history"
```

---

### Task 5: Escape-safe sessions, Resume, and confirmed Start over

**Files:**
- Modify: `static/app.js`

**Interfaces:**
- Consumes: `StoryStore.saveGuidedSession/loadGuidedSession/clearGuidedSession` (Task 2); `currentSuggestion()`, `guidedState.versions` (Task 3); `guidedState.uiMode` (Task 4).
- Produces: `persistGuidedSession()` — called by Task 4's handlers.

- [ ] **Step 1: Add the persistence helper**

Replace the temporary no-op from Task 4 (or add above `currentSuggestion()` if it was never added):

```javascript
function persistGuidedSession() {
  if (!guidedState || !guidedState.currentStageKey) return;
  // Don't persist a transient sub-view; resume should always land on the
  // passage, never mid-edit.
  const snapshot = { ...guidedState, loading: false, uiMode: "preview" };
  StoryStore.saveGuidedSession(guidedState.currentStageKey, snapshot);
}
```

- [ ] **Step 2: Persist whenever answers change**

In the answer-submit handler, find:
```javascript
          guidedState.idx++;
```
and add directly after it:
```javascript
          persistGuidedSession();
```

Also in `doWeave`, inside the `finally` block, find:
```javascript
      guidedState.loading = false;
```
and add directly after it:
```javascript
      persistGuidedSession();
```

- [ ] **Step 3: Stop Escape and tile-close from discarding**

In `collapseFocused()`, find:
```javascript
function collapseFocused() {
  focusedKey = null;
  guidedState = null;
  guidedGeneration++;
  render();
}
```
Replace with:
```javascript
function collapseFocused() {
  // Collapsing is not discarding — the session is persisted and resumable.
  persistGuidedSession();
  focusedKey = null;
  guidedState = null;
  guidedGeneration++;
  render();
}
```

In `focusStage()`, find:
```javascript
    guidedState = null;
```
Replace with:
```javascript
    persistGuidedSession();
    guidedState = null;
```

- [ ] **Step 4: Offer Resume when a stage has a stored session**

Find this exact block in the render path (it sits just before the `} else {` that begins the guided-flow branch):

```javascript
      } else if (!guidedState) {
        bodyHtml = `
          <div class="empty-stage-prompt">
            <p class="empty-hint">No content yet for this stage.</p>
            <button class="ai-btn start-guided-btn">Start Guided Flow</button>
          </div>
        `;
```

Replace the whole block with:

```javascript
      } else if (!guidedState) {
        const saved = StoryStore.loadGuidedSession(s.key);
        if (saved) {
          const answers = (saved.q_and_a || []).length;
          const versionCount = (saved.versions || []).length;
          const versionNote = versionCount
            ? `, ${versionCount} passage version${versionCount === 1 ? "" : "s"}`
            : "";
          bodyHtml = `
            <div class="empty-stage-prompt">
              <div class="resume-summary">Guided session in progress — ${answers} answer${answers === 1 ? "" : "s"}${versionNote}</div>
              <div class="preview-actions">
                <button class="ai-btn resume-btn">Resume</button>
                <button class="action-btn start-over-btn">Start over…</button>
              </div>
            </div>
          `;
        } else {
          bodyHtml = `
            <div class="empty-stage-prompt">
              <p class="empty-hint">No content yet for this stage.</p>
              <button class="ai-btn start-guided-btn">Start Guided Flow</button>
            </div>
          `;
        }

- [ ] **Step 5: Wire Resume and Start over**

Alongside the existing `start-guided-btn` handler, add:

```javascript
      const resumeBtn = el.querySelector(".resume-btn");
      if (resumeBtn) {
        resumeBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const saved = StoryStore.loadGuidedSession(s.key);
          if (!saved) return;
          guidedGeneration++;
          guidedState = { ...saved, loading: false, uiMode: "preview" };
          render();
        });
      }

      const startOverBtn = el.querySelector(".start-over-btn");
      if (startOverBtn) {
        startOverBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const saved = StoryStore.loadGuidedSession(s.key);
          const answers = (saved && saved.q_and_a ? saved.q_and_a.length : 0);
          // The only path that destroys a session — always confirmed.
          if (!confirm(`Discard ${answers} answer${answers === 1 ? "" : "s"} and start this stage over?`)) return;
          StoryStore.clearGuidedSession(s.key);
          guidedState = null;
          guidedGeneration++;
          render();
        });
      }
```

- [ ] **Step 6: Clear the stored session on Accept**

In the Accept handler, find:
```javascript
          guidedState = null;
```
and add directly **before** it:
```javascript
          StoryStore.clearGuidedSession(s.key);
```

- [ ] **Step 7: Verify syntax and the resume styles**

Append to `static/style.css`:

```css
.resume-summary {
  font-size: 0.8rem;
  color: var(--text-secondary);
  margin-bottom: 0.6rem;
}
.action-btn.start-over-btn {
  background: transparent;
  color: var(--text-secondary);
}
```

Run: `node --check static/app.js && echo "js OK"`
Expected: `js OK`. A failure here almost certainly means the Step 4 block replacement left an unbalanced brace or backtick — re-check that the replaced region starts at `} else if (!guidedState) {` and that the original block's trailing `` `; `` was consumed.

- [ ] **Step 8: Verify in the browser — the regression that motivated this**

1. Start a guided flow, answer two questions, press **Escape**. The tile collapses.
2. Reopen the stage. It shows *"Guided session in progress — 2 answers"* with **Resume** / **Start over…**.
3. **Resume** — your answers are intact and the flow continues where it left off.
4. Repeat, but **refresh the page** instead of pressing Escape. Reopening still offers Resume with the same answers.
5. **Start over…** → the confirm appears. **Cancel** leaves the session intact; confirming clears it and the stage offers Start Guided Flow again.
6. Complete a flow and **Accept** — reopening the stage offers Start Guided Flow, not Resume.

- [ ] **Step 9: Commit**

```bash
git add static/app.js static/style.css
git commit -m "feat: escape no longer discards a guided session"
```

---

### Task 6: Full-suite regression check and end-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Python suite must be untouched**

Run: `.venv/bin/python -m pytest tests/ -q`
Expected: `18 passed`. This plan changes no Python; any failure means something out of scope was edited.

- [ ] **Step 2: Static asset sanity**

Run:
```bash
node --check static/app.js && node --check static/js/ai-client.js && node --check static/js/story-store.js && echo "js OK"
python3 -m json.tool static/data/models.json > /dev/null && echo "models.json OK"
```
Expected: `js OK`, `models.json OK`.

- [ ] **Step 3: One full revise round-trip on a real provider**

With a real key set, complete a guided flow, revise it once with feedback, step back to v1, then Accept v2. Confirm the accepted text lands in the stage and the story export contains the version history with `accepted_version_index`.

Do this against at least one live provider. The multi-provider work shipped four bugs that only a real API call caught — spec-level verification is not sufficient here.

- [ ] **Step 4: Confirm no path destroys work in one action**

Walk each exit deliberately: Escape, clicking another stage, refreshing, and closing the tile with ✕. None may lose answers. The only destructive path is **Start over…**, and it must confirm first.

No commit — this task is verification of Tasks 1–5.
