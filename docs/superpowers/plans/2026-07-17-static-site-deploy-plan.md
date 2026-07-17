# Static Site + BYO-Key + GitHub Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the frontend into a fully client-side app (localStorage story storage, BYO OpenCode Zen key, model + age-range selection) and publish it to GitHub Pages, routing AI calls through a Cloudflare Worker CORS relay.

**Architecture:** New small, focused JS modules (`settings.js`, `story-store.js`, `ai-client.js`, `export-import.js`) loaded as classic `<script>` tags before `app.js` (matching the existing no-build, no-module-bundler style). `app.js` is modified to call these modules instead of Flask's `/api/*` routes. A Cloudflare Worker forwards AI requests to `https://opencode.ai/zen/go` and adds CORS headers. GitHub Actions publishes the `static/` folder to GitHub Pages on every push to `main`.

**Tech Stack:** Vanilla JS (no build step, no framework), Cloudflare Workers, GitHub Actions (`actions/deploy-pages`).

## Global Constraints

- **Depends on** `docs/superpowers/plans/2026-07-17-flask-age-model-plan.md` Task 1 having been completed first — this plan reads `static/data/models.json` and `static/data/age_guidance.json` created there. If that plan hasn't run yet, do Task 1 of that plan before starting here.
- No build tooling is introduced (no npm/webpack/vite) — plain `<script>` tags, matching the existing `static/app.js` style.
- `age_range` values: `kids | tween | teen | adult`, default `adult`. Model default: `mimo-v2.5`.
- Nothing sensitive (API keys) is ever sent anywhere except the Cloudflare Worker and, from the Worker, straight to `https://opencode.ai/zen/go`. The Worker stores nothing.
- No JS test runner exists in this repo and none is added (YAGNI for a small static app) — each JS task is verified manually via a local static server and browser devtools, with exact commands given in the step.

---

### Task 1: `static/data/stages.json`

**Files:**
- Create: `static/data/stages.json`

**Interfaces:**
- Produces: a JSON array of `{key, title, prompt}` objects, one per Hero's Journey stage, in the same order and with the same values as `stages_as_list()` in `models.py`.

- [ ] **Step 1: Generate the file from the existing Python source of truth**

Run:
```bash
python3 -c "
import json
from models import stages_as_list
print(json.dumps(stages_as_list(), indent=2))
" > static/data/stages.json
```

- [ ] **Step 2: Verify**

Run: `node -e "const s = require('./static/data/stages.json'); console.log(s.length, s[0].key)"`
Expected output: `12 ordinary_world`

- [ ] **Step 3: Commit**

```bash
git add static/data/stages.json
git commit -m "Add static stages.json for the client-side site"
```

---

### Task 2: `static/js/settings.js`

**Files:**
- Create: `static/js/settings.js`

**Interfaces:**
- Produces: global `Settings` object with `Settings.load(): {apiKey, model, ageRange}` and `Settings.save(partial): {apiKey, model, ageRange}` (merges `partial` into the stored settings and persists to `localStorage` under key `"hj_settings"`).

- [ ] **Step 1: Implement**

```js
// static/js/settings.js
const Settings = (() => {
  const KEY = "hj_settings";
  const DEFAULTS = { apiKey: "", model: "mimo-v2.5", ageRange: "adult" };

  function load() {
    try {
      return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
    } catch (err) {
      return { ...DEFAULTS };
    }
  }

  function save(partial) {
    const merged = { ...load(), ...partial };
    localStorage.setItem(KEY, JSON.stringify(merged));
    return merged;
  }

  return { load, save };
})();
```

- [ ] **Step 2: Verify**

Run: `python3 -m http.server 8000 --directory static` (leave running), then open `http://127.0.0.1:8000/index.html` in a browser and open devtools console. Since `index.html` doesn't load this script yet, instead verify directly:

Run in the terminal: `node -e "
global.localStorage = (() => { const s = {}; return { getItem: k => s[k] ?? null, setItem: (k,v) => { s[k]=v; } }; })();
$(cat static/js/settings.js)
console.log(Settings.load());
console.log(Settings.save({ apiKey: 'sk-test', ageRange: 'kids' }));
console.log(Settings.load());
"`

Expected output (three lines):
```
{ apiKey: '', model: 'mimo-v2.5', ageRange: 'adult' }
{ apiKey: 'sk-test', model: 'mimo-v2.5', ageRange: 'kids' }
{ apiKey: 'sk-test', model: 'mimo-v2.5', ageRange: 'kids' }
```

- [ ] **Step 3: Commit**

```bash
git add static/js/settings.js
git commit -m "Add client-side Settings module (localStorage)"
```

---

### Task 3: `static/js/story-store.js`

**Files:**
- Create: `static/js/story-store.js`

**Interfaces:**
- Consumes: `stageTemplates: {key, title, prompt}[]` (from `static/data/stages.json`, Task 1).
- Produces: global `StoryStore` object:
  - `StoryStore.wordCount(content: string): number`
  - `StoryStore.stageStatus(content: string): "empty"|"started"|"done"`
  - `StoryStore.load(stageTemplates): {title, ageRange, stages: {[key]: {content}}, lastSaved}`
  - `StoryStore.save(story): string` (returns new `lastSaved` timestamp, persists to `localStorage` under `"hj_story"`)
  - `StoryStore.saveStageContent(story, key, content): {wordCount, status}` (mutates `story.stages[key]` and saves)
  - `StoryStore.completedCount(story): number`

- [ ] **Step 1: Implement**

```js
// static/js/story-store.js
const StoryStore = (() => {
  const KEY = "hj_story";

  function wordCount(content) {
    return content.trim() ? content.trim().split(/\s+/).length : 0;
  }

  function stageStatus(content) {
    if (!content.trim()) return "empty";
    if (wordCount(content) < 50) return "started";
    return "done";
  }

  function defaultStory(stageTemplates) {
    const stages = {};
    stageTemplates.forEach((t) => { stages[t.key] = { content: "" }; });
    return { title: "Untitled Story", ageRange: "adult", stages, lastSaved: null };
  }

  function load(stageTemplates) {
    const raw = localStorage.getItem(KEY);
    let parsed = null;
    if (raw) {
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        parsed = null;
      }
    }
    const stages = {};
    stageTemplates.forEach((t) => {
      stages[t.key] = { content: parsed?.stages?.[t.key]?.content || "" };
    });
    return {
      title: parsed?.title || "Untitled Story",
      ageRange: parsed?.ageRange || "adult",
      stages,
      lastSaved: parsed?.lastSaved || null,
    };
  }

  function save(story) {
    story.lastSaved = new Date().toLocaleTimeString();
    localStorage.setItem(KEY, JSON.stringify(story));
    return story.lastSaved;
  }

  function saveStageContent(story, key, content) {
    story.stages[key] = { content };
    save(story);
    return { wordCount: wordCount(content), status: stageStatus(content) };
  }

  function completedCount(story) {
    return Object.values(story.stages).filter((s) => stageStatus(s.content) === "done").length;
  }

  return { wordCount, stageStatus, load, save, saveStageContent, completedCount };
})();
```

- [ ] **Step 2: Verify**

Run: `node -e "
global.localStorage = (() => { const s = {}; return { getItem: k => s[k] ?? null, setItem: (k,v) => { s[k]=v; } }; })();
$(cat static/js/story-store.js)
const templates = [{key:'ordinary_world'}, {key:'call_to_adventure'}];
let story = StoryStore.load(templates);
console.log(story.title, story.ageRange, Object.keys(story.stages));
const result = StoryStore.saveStageContent(story, 'ordinary_world', 'word '.repeat(55).trim());
console.log(result);
console.log(StoryStore.completedCount(story));
"`

Expected output:
```
Untitled Story adult [ 'ordinary_world', 'call_to_adventure' ]
{ wordCount: 55, status: 'done' }
1
```

- [ ] **Step 3: Commit**

```bash
git add static/js/story-store.js
git commit -m "Add client-side StoryStore module (localStorage)"
```

---

### Task 4: `static/js/ai-client.js`

**Files:**
- Create: `static/js/ai-client.js`

**Interfaces:**
- Consumes: `Settings.load()` (Task 2); `static/data/age_guidance.json` (fetched at runtime); a Cloudflare Worker reachable at `WORKER_URL` (deployed in Task 8 — the placeholder value here is replaced once the Worker exists, in Task 9).
- Produces: global `AIClient` object with `AIClient.generateQuestions(stagePrompt, storySoFar, qAndA): Promise<string[]>` and `AIClient.weaveAnswers(stagePrompt, storySoFar, qAndA): Promise<string>`. Both throw an `Error` with a user-facing message if no API key is set or the API call fails. Mirrors the system-prompt text and age-guidance prepending in `ai.py`'s `generate_questions`/`weave_answers` exactly, so behavior matches the Flask mode.

- [ ] **Step 1: Implement**

```js
// static/js/ai-client.js
const AIClient = (() => {
  const WORKER_URL = "https://REPLACE_ME.workers.dev"; // updated in Task 9 after the Worker is deployed
  let ageGuidanceCache = null;

  async function getAgeGuidance(ageRange) {
    if (!ageGuidanceCache) {
      const res = await fetch("data/age_guidance.json");
      ageGuidanceCache = await res.json();
    }
    return ageGuidanceCache[ageRange] || "";
  }

  async function callChat(systemMsg, userMsg) {
    const settings = Settings.load();
    if (!settings.apiKey) {
      throw new Error("No API key set. Open Settings and add your OpenCode Zen key.");
    }

    const res = await fetch(`${WORKER_URL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${settings.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: settings.model,
        messages: [
          { role: "system", content: systemMsg },
          { role: "user", content: userMsg },
        ],
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.error?.message || `API error ${res.status}`);
    }
    return data.choices[0].message.content.trim();
  }

  async function generateQuestions(stagePrompt, storySoFar, qAndA) {
    const settings = Settings.load();
    let systemMsg =
      "You are an expert storytelling guide. Your task is to guide the user in writing the next stage of their story. " +
      "Ask questions that are easy to answer, quick, and cut to the point. " +
      "Use a casual, conversational, and friendly tone in your questions. Avoid sounding overly formal or academic. " +
      "Based on the stage context, the story so far, and the questions the user has already answered, decide if more information is needed to write a complete entry. " +
      "If you have a full picture and no more questions are needed, output an empty JSON array []. " +
      "If more questions are needed, generate 1 to 2 new thought-provoking questions. " +
      "Output ONLY a valid JSON array of strings, e.g., [\"Question 1?\"], with no markdown formatting.";

    const guidance = await getAgeGuidance(settings.ageRange);
    if (guidance) systemMsg = `${guidance}\n\n${systemMsg}`;

    let qaText = "";
    if (qAndA.length > 0) {
      qaText = "\n\nUser's answers so far:\n" + qAndA.map((item) => `Q: ${item.q}\nA: ${item.a}`).join("\n");
    }
    const userMsg = `Story so far:\n${storySoFar || "(Beginning of the story)"}\n\nStage context: ${stagePrompt}${qaText}`;

    let content = (await callChat(systemMsg, userMsg)).trim();
    if (content.startsWith("```json")) content = content.slice(7);
    if (content.startsWith("```")) content = content.slice(3);
    if (content.endsWith("```")) content = content.slice(0, -3);
    return JSON.parse(content.trim());
  }

  async function weaveAnswers(stagePrompt, storySoFar, qAndA) {
    const settings = Settings.load();
    let systemMsg =
      "You are an expert storyteller. The user has answered a series of guiding questions for a specific stage of the Hero's Journey. " +
      "Your task is to weave their answers into a cohesive, well-written narrative passage for this stage. " +
      "Use their ideas directly, adopting a descriptive and engaging tone that matches the story so far. " +
      "Output only the narrative text, no extra commentary.";

    const guidance = await getAgeGuidance(settings.ageRange);
    if (guidance) systemMsg = `${guidance}\n\n${systemMsg}`;

    const qaText = qAndA.map((item) => `Q: ${item.q}\nA: ${item.a}`).join("\n");
    const userMsg = `Story so far:\n${storySoFar || "(Beginning of the story)"}\n\nStage context: ${stagePrompt}\n\nUser's Q&A:\n${qaText}`;

    return callChat(systemMsg, userMsg);
  }

  return { generateQuestions, weaveAnswers };
})();
```

- [ ] **Step 2: Verify (structure only — full network verification happens in Task 10 once the Worker is live)**

Run: `node -e "
global.fetch = async (url) => ({ ok:false, status:0, json: async () => ({}) });
global.localStorage = (() => { const s = {}; return { getItem: k => s[k] ?? null, setItem: (k,v) => { s[k]=v; } }; })();
$(cat static/js/settings.js)
$(cat static/js/ai-client.js)
AIClient.generateQuestions('p', 's', []).catch((e) => console.log('threw:', e.message));
"`

Expected output: `threw: No API key set. Open Settings and add your OpenCode Zen key.`

- [ ] **Step 3: Commit**

```bash
git add static/js/ai-client.js
git commit -m "Add client-side AIClient module (Worker relay calls)"
```

---

### Task 5: `static/js/export-import.js`

**Files:**
- Create: `static/js/export-import.js`

**Interfaces:**
- Produces: global `StoryIO` object with `StoryIO.exportStory(story): void` (triggers a `story.json` download) and `StoryIO.importStory(file: File): Promise<object>` (parses the uploaded file as JSON, rejects with `Error("Invalid JSON file")` on parse failure).

- [ ] **Step 1: Implement**

```js
// static/js/export-import.js
const StoryIO = (() => {
  function exportStory(story) {
    const blob = new Blob([JSON.stringify(story, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "story.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  function importStory(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          resolve(JSON.parse(reader.result));
        } catch (err) {
          reject(new Error("Invalid JSON file"));
        }
      };
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsText(file);
    });
  }

  return { exportStory, importStory };
})();
```

- [ ] **Step 2: Verify**

This module uses browser-only APIs (`Blob`, `FileReader`) — verified in the browser in Task 8 once wired into the settings panel. No standalone Node check for this one (would require a jsdom-style shim that isn't worth adding for two functions — YAGNI).

- [ ] **Step 3: Commit**

```bash
git add static/js/export-import.js
git commit -m "Add client-side StoryIO module (export/import JSON)"
```

---

### Task 6: Settings panel UI (`index.html` + `style.css`)

**Files:**
- Modify: `static/index.html`
- Modify: `static/style.css`

**Interfaces:**
- Produces: DOM elements consumed by Task 7's `app.js` wiring — `#settings-toggle`, `#settings-panel`, `#api-key-input`, `#model-select`, `#age-range-select`, `#export-btn`, `#import-input`, `#settings-close`.

- [ ] **Step 1: Add the settings panel markup and script tags**

Replace the `<body>` contents of `static/index.html`:

```html
<body>
  <h1>HERO'S JOURNEY</h1>
  <button id="settings-toggle" class="settings-toggle" title="Settings">⚙</button>
  <div class="status-bar" id="status-bar">0/12 stages complete</div>
  <div class="grid" id="grid"></div>
  <p class="instructions">Click a stage to focus · Esc to save and collapse · ⌘/Ctrl+S to save</p>

  <div id="settings-panel" class="settings-panel hidden">
    <h2>Settings</h2>
    <label>OpenCode Zen API Key
      <input type="password" id="api-key-input" placeholder="sk-...">
    </label>
    <label>Model
      <select id="model-select"></select>
    </label>
    <label>Story age range
      <select id="age-range-select">
        <option value="kids">Kids (6-9)</option>
        <option value="tween">Tween (10-12)</option>
        <option value="teen">Teen (13-17)</option>
        <option value="adult">Adult</option>
      </select>
    </label>
    <div class="settings-actions">
      <button id="export-btn">Export story</button>
      <label class="import-label" for="import-input">Import story</label>
      <input type="file" id="import-input" accept="application/json" hidden>
    </div>
    <button id="settings-close">Close</button>
  </div>

  <script src="js/settings.js"></script>
  <script src="js/story-store.js"></script>
  <script src="js/ai-client.js"></script>
  <script src="js/export-import.js"></script>
  <script src="app.js"></script>
</body>
```

- [ ] **Step 2: Add settings panel styles**

Append to `static/style.css`:

```css
.settings-toggle {
  position: fixed;
  top: 1rem;
  right: 1rem;
  background: #15151f;
  border: 1px solid #252530;
  border-radius: 6px;
  color: #e0e0e0;
  font-size: 1.1rem;
  width: 2.2rem;
  height: 2.2rem;
  cursor: pointer;
}

.settings-toggle:hover { border-color: #3b82f6; }

.settings-panel {
  position: fixed;
  top: 3.5rem;
  right: 1rem;
  width: 280px;
  background: #15151f;
  border: 1px solid #252530;
  border-radius: 8px;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  z-index: 10;
}

.settings-panel.hidden { display: none; }

.settings-panel h2 {
  font-size: 0.9rem;
  font-weight: 400;
  color: #888;
}

.settings-panel label {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.75rem;
  color: #888;
}

.settings-panel input,
.settings-panel select {
  background: #0a0a0f;
  border: 1px solid #252530;
  border-radius: 4px;
  color: #e0e0e0;
  padding: 0.4rem;
  font-size: 0.8rem;
}

.settings-actions {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.settings-actions button,
.import-label {
  background: #0a0a0f;
  border: 1px solid #252530;
  border-radius: 4px;
  color: #e0e0e0;
  padding: 0.4rem 0.6rem;
  font-size: 0.75rem;
  cursor: pointer;
}

#settings-close {
  align-self: flex-end;
  background: none;
  border: none;
  color: #666;
  cursor: pointer;
  font-size: 0.75rem;
}
```

- [ ] **Step 3: Verify**

Run: `python3 -m http.server 8000 --directory static`, open `http://127.0.0.1:8000/index.html`. Expected: page loads with a gear icon top-right (Task 7 wires its click behavior — clicking it does nothing yet, that's expected at this point). No console errors about the new script files 404ing.

- [ ] **Step 4: Commit**

```bash
git add static/index.html static/style.css
git commit -m "Add settings panel markup and styles"
```

---

### Task 7: Rewire `app.js` to the client-side modules

**Files:**
- Modify: `static/app.js` (top-level state, `init`, `saveStageContent`, `startGuidedFlow`, `fetchMoreQuestionsInBackground`, `doWeave`)

**Interfaces:**
- Consumes: `StoryStore` (Task 3), `AIClient` (Task 4), `Settings` (Task 2), `StoryIO` (Task 5), the settings panel DOM elements (Task 6).
- Produces: `app.js` no longer makes any `fetch()` calls to `/api/*`.

- [ ] **Step 1: Replace top-level state and `init`**

At the top of `static/app.js`, add a `currentStory` variable next to the existing globals:

```js
let stages = [];
let focusedKey = null;
let selectedIdx = 0;
let guidedState = null;
let currentStory = null;
```

Replace the `init` function:

```js
async function init() {
  const stagesRes = await fetch("data/stages.json");
  const templates = await stagesRes.json();
  currentStory = StoryStore.load(templates);

  stages = templates.map((t, i) => {
    const content = currentStory.stages[t.key].content;
    return {
      key: t.key,
      num: String(i + 1),
      title: t.title,
      prompt: t.prompt,
      content,
      wordCount: StoryStore.wordCount(content),
      status: StoryStore.stageStatus(content),
    };
  });

  render();
  updateStatusBar(StoryStore.completedCount(currentStory));
  initSettingsPanel();
}
```

- [ ] **Step 2: Replace `saveStageContent`**

```js
async function saveStageContent(key, content) {
  const stage = stages.find((s) => s.key === key);
  const result = StoryStore.saveStageContent(currentStory, key, content);
  stage.content = content;
  stage.wordCount = result.wordCount;
  stage.status = result.status;
  updateStatusBar(stages.filter((s) => s.status === "done").length);
}
```

- [ ] **Step 3: Replace `startGuidedFlow`**

```js
async function startGuidedFlow(key) {
  guidedState = { loading: true, questions: [], q_and_a: [], idx: 0, suggestion: null, error: null, fetchingBackground: false, waitingForMore: false, noMoreQuestions: false };
  render();
  const stage = stages.find((s) => s.key === key);
  const storySoFar = stages.slice(0, stages.indexOf(stage)).map((s) => s.content).filter(Boolean).join("\n\n");
  try {
    const questions = await AIClient.generateQuestions(stage.prompt, storySoFar, []);
    if (questions.length > 0) {
      guidedState.questions = questions;
    } else {
      guidedState.error = "AI returned no initial questions.";
    }
    guidedState.loading = false;
  } catch (err) {
    guidedState.error = err.message || "Network error";
    guidedState.loading = false;
  }
  if (focusedKey === key) render();
}
```

- [ ] **Step 4: Replace `fetchMoreQuestionsInBackground`**

```js
async function fetchMoreQuestionsInBackground(key) {
  if (guidedState.noMoreQuestions || guidedState.fetchingBackground) return;
  guidedState.fetchingBackground = true;
  const stage = stages.find((s) => s.key === key);
  const storySoFar = stages.slice(0, stages.indexOf(stage)).map((s) => s.content).filter(Boolean).join("\n\n");
  try {
    const questions = await AIClient.generateQuestions(stage.prompt, storySoFar, guidedState.q_and_a);
    if (questions.length > 0) {
      guidedState.questions.push(...questions);
      if (guidedState.waitingForMore) {
        guidedState.waitingForMore = false;
        if (focusedKey === key) render();
      }
    } else {
      guidedState.noMoreQuestions = true;
      if (guidedState.waitingForMore) {
        await doWeave(key);
      }
    }
  } catch (err) {
    console.error("Background fetch failed", err);
  } finally {
    if (guidedState) guidedState.fetchingBackground = false;
  }
}
```

- [ ] **Step 5: Replace `doWeave`**

```js
async function doWeave(key) {
  guidedState.loading = true;
  guidedState.waitingForMore = false;
  if (focusedKey === key) render();
  const stage = stages.find((s) => s.key === key);
  const storySoFar = stages.slice(0, stages.indexOf(stage)).map((s) => s.content).filter(Boolean).join("\n\n");
  try {
    guidedState.suggestion = await AIClient.weaveAnswers(stage.prompt, storySoFar, guidedState.q_and_a);
  } catch (err) {
    guidedState.error = err.message || "Network error";
  } finally {
    guidedState.loading = false;
    if (focusedKey === key) render();
  }
}
```

- [ ] **Step 6: Add `initSettingsPanel`, called from `init` (Step 1)**

Append near the bottom of `static/app.js`, before the final `init();` call:

```js
async function initSettingsPanel() {
  const toggle = document.getElementById("settings-toggle");
  const panel = document.getElementById("settings-panel");
  const apiKeyInput = document.getElementById("api-key-input");
  const modelSelect = document.getElementById("model-select");
  const ageRangeSelect = document.getElementById("age-range-select");
  const exportBtn = document.getElementById("export-btn");
  const importInput = document.getElementById("import-input");
  const closeBtn = document.getElementById("settings-close");

  const settings = Settings.load();
  apiKeyInput.value = settings.apiKey;
  ageRangeSelect.value = currentStory.ageRange || settings.ageRange;

  const modelsRes = await fetch("data/models.json");
  const models = await modelsRes.json();
  modelSelect.innerHTML = models.map((m) => `<option value="${m}">${m}</option>`).join("");
  modelSelect.value = settings.model;

  toggle.addEventListener("click", () => panel.classList.toggle("hidden"));
  closeBtn.addEventListener("click", () => panel.classList.add("hidden"));

  apiKeyInput.addEventListener("change", () => Settings.save({ apiKey: apiKeyInput.value }));
  modelSelect.addEventListener("change", () => Settings.save({ model: modelSelect.value }));
  ageRangeSelect.addEventListener("change", () => {
    Settings.save({ ageRange: ageRangeSelect.value });
    currentStory.ageRange = ageRangeSelect.value;
    StoryStore.save(currentStory);
  });

  exportBtn.addEventListener("click", () => StoryIO.exportStory(currentStory));
  importInput.addEventListener("change", async () => {
    const file = importInput.files[0];
    if (!file) return;
    try {
      const imported = await StoryIO.importStory(file);
      currentStory = imported;
      StoryStore.save(currentStory);
      location.reload();
    } catch (err) {
      alert(err.message);
    }
  });
}
```

- [ ] **Step 7: Verify end-to-end in the browser (no live AI call yet — that's Task 10)**

Run: `python3 -m http.server 8000 --directory static`, open `http://127.0.0.1:8000/index.html`.

Manual checks:
1. The 12-stage grid renders (confirms `data/stages.json` fetch + `StoryStore.load` work).
2. Click a stage, type in the guided-flow answer box — expect an error message "No API key set..." to render (confirms `AIClient` is wired and throws correctly without a key, since Task 9's Worker isn't deployed yet).
3. Click the gear icon — settings panel opens; the model `<select>` is populated with 22 options (confirms `data/models.json` fetch).
4. Type a key into the API key field, tab away, reload the page, reopen settings — the key persists (confirms `Settings` localStorage round-trip).
5. Click "Export story" — a `story.json` file downloads (confirms `StoryIO.exportStory`).

- [ ] **Step 8: Commit**

```bash
git add static/app.js
git commit -m "Rewire app.js to client-side StoryStore/AIClient/Settings modules"
```

---

### Task 8: Cloudflare Worker CORS relay

**Files:**
- Create: `cloudflare-worker/worker.js`
- Create: `cloudflare-worker/wrangler.toml`

**Interfaces:**
- Produces: a deployable Worker that forwards any request to `https://opencode.ai/zen/go<path>` with the client's `Authorization` and `Content-Type` headers, adds CORS headers to the response, and handles `OPTIONS` preflight requests. Consumed by `AIClient` (Task 4) once deployed and its URL is filled into `WORKER_URL` (Task 9).

- [ ] **Step 1: Implement the Worker**

```js
// cloudflare-worker/worker.js
const UPSTREAM = "https://opencode.ai/zen/go";

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "authorization, content-type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const upstreamUrl = `${UPSTREAM}${url.pathname}${url.search}`;
    const upstreamRequest = new Request(upstreamUrl, {
      method: request.method,
      headers: {
        "Authorization": request.headers.get("Authorization") || "",
        "Content-Type": request.headers.get("Content-Type") || "application/json",
      },
      body: request.method === "GET" ? undefined : await request.text(),
    });

    const upstreamResponse = await fetch(upstreamRequest);
    const responseBody = await upstreamResponse.text();

    return new Response(responseBody, {
      status: upstreamResponse.status,
      headers: {
        "Content-Type": upstreamResponse.headers.get("Content-Type") || "application/json",
        ...corsHeaders,
      },
    });
  },
};
```

```toml
# cloudflare-worker/wrangler.toml
name = "hero-journey-ai-relay"
main = "worker.js"
compatibility_date = "2026-07-17"
```

- [ ] **Step 2: Verify locally**

Run: `cd cloudflare-worker && npx wrangler dev` (this downloads `wrangler` on first run via npx — no global install needed). In another terminal:

```bash
curl -s -i -X OPTIONS http://127.0.0.1:8787/v1/chat/completions \
  -H "Origin: http://127.0.0.1:8000" | grep -i "access-control\|^HTTP"
```

Expected: `HTTP/1.1 204 No Content` and an `access-control-allow-origin: *` header present. Stop `wrangler dev` with Ctrl+C.

- [ ] **Step 3: Commit**

```bash
git add cloudflare-worker/worker.js cloudflare-worker/wrangler.toml
git commit -m "Add Cloudflare Worker CORS relay for OpenCode Zen"
```

---

### Task 9: GitHub Actions Pages deployment workflow

**Files:**
- Create: `.github/workflows/deploy-pages.yml`

**Interfaces:**
- Produces: a workflow that, on push to `main`, publishes the `static/` folder as the GitHub Pages site.

- [ ] **Step 1: Implement**

```yaml
# .github/workflows/deploy-pages.yml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: "pages"
  cancel-in-progress: true

jobs:
  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      - name: Setup Pages
        uses: actions/configure-pages@v5
      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: static
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: Verify**

Run: `cat .github/workflows/deploy-pages.yml | python3 -c "import sys, yaml; yaml.safe_load(sys.stdin)" 2>&1 || pip install pyyaml --quiet && cat .github/workflows/deploy-pages.yml | python3 -c "import sys, yaml; yaml.safe_load(sys.stdin); print('valid yaml')"`
Expected: `valid yaml` (no parse errors). Full verification happens live once pushed (Task 10).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/deploy-pages.yml
git commit -m "Add GitHub Actions workflow to deploy static/ to GitHub Pages"
```

---

### Task 10: Deploy — GitHub repo, Cloudflare Worker, wire URL, verify live

This task is manual (account-level actions the agent can perform via CLI but that create real, externally-visible resources — repo creation, a live public URL, a live Cloudflare Worker).

- [ ] **Step 1: Create and push the GitHub repo**

```bash
gh repo create heros-journey-tui --public --source=. --remote=origin --push
```

- [ ] **Step 2: Enable GitHub Pages via GitHub Actions as the source**

```bash
gh api -X PUT repos/{owner}/heros-journey-tui/pages -f build_type=workflow
```

If that 404s (Pages not yet initialized), instead go to the repo's Settings → Pages in the browser and set Source to "GitHub Actions" — then re-push (or run `gh workflow run deploy-pages.yml`) to trigger the first deploy.

- [ ] **Step 3: Deploy the Cloudflare Worker**

```bash
cd cloudflare-worker
npx wrangler login
npx wrangler deploy
```

Note the deployed URL from the output (e.g. `https://hero-journey-ai-relay.<your-subdomain>.workers.dev`).

- [ ] **Step 4: Wire the Worker URL into the static site**

In `static/js/ai-client.js`, replace:

```js
const WORKER_URL = "https://REPLACE_ME.workers.dev";
```

with the real URL from Step 3, e.g.:

```js
const WORKER_URL = "https://hero-journey-ai-relay.your-subdomain.workers.dev";
```

```bash
git add static/js/ai-client.js
git commit -m "Point AIClient at the deployed Cloudflare Worker"
git push
```

This push triggers the GitHub Actions workflow (Task 9), redeploying Pages with the correct Worker URL.

- [ ] **Step 5: Verify the live site end-to-end**

1. Wait for the "Deploy to GitHub Pages" workflow run to go green: `gh run watch`.
2. Open the Pages URL (`gh api repos/{owner}/heros-journey-tui/pages --jq .html_url`).
3. Open Settings, paste a real OpenCode Zen key, pick a model, pick an age range, close the panel.
4. Click an empty stage — confirm the guided-flow questions load (a real AI call went browser → Worker → OpenCode Zen and back).
5. Answer a question and click "Weave Story Now" — confirm generated text appears and "Accept" saves it into the stage.
6. Reload the page — confirm the saved stage content and settings persist (localStorage).
7. Click "Export story" and re-import it — confirm the story reloads correctly.

---

## Self-Review Notes

- **Spec coverage:** localStorage story storage + export/import (Tasks 3, 5), BYO API key + model selection (Tasks 2, 4, 6, 7), Cloudflare Worker CORS relay (Task 8), GitHub Pages deploy via Actions (Task 9), end-to-end live verification (Task 10) — all covered. Age-range tailoring itself (the guidance text and Flask-side logic) is covered by the companion plan; this plan only consumes the shared data file.
- **No placeholders:** every step has complete code or an exact command with expected output. The one literal placeholder string, `"https://REPLACE_ME.workers.dev"`, is intentional and immediately resolved in Task 10 Step 4 — it can't be known before the Worker is deployed.
- **Type/naming consistency:** `story.ageRange` (camelCase, matches the JSON API boundary convention used in the Flask plan's `ageRange` key) is used consistently across `story-store.js`, `app.js`, and the settings panel wiring.
