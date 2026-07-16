# Focus Grid Web App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate the four abandoned/partial Hero's Journey implementations into one working app: a Flask backend (kept as-is, relocated to project root) serving a CSS Grid frontend where focusing a stage expands it in place, collapses the others, and swaps content density (collapsed → idle/summary → focused/full editor).

**Architecture:** Static single-page frontend (`index.html` + `app.js` + `style.css`) served by Flask, talking to three existing REST endpoints (`/api/stages`, `/api/story`, `/api/story/stage/<key>`). All UI state (which stage is focused, which is selected) lives in `app.js` as plain module-level variables — no framework, no build step.

**Tech Stack:** Python 3 + Flask 3, vanilla HTML/CSS/JS.

## Global Constraints

- Backend endpoints and their request/response shapes do not change (see `heros-journey-web/app.py`, `heros-journey-web/models.py` — being relocated, not rewritten).
- No test framework exists in this project and none is being added; verification is manual (curl for the API, browser interaction for the UI), per the design spec's Testing section.
- No animation/JS library — CSS `transition` only, per design spec.
- Textarea content must never be injected into `innerHTML` — user story text is untrusted-ish free text (could contain `</textarea>` or `<script>`) and must be set via the DOM `.value` property or escaped with `textContent`, not string interpolation.

---

### Task 1: Delete dead implementations and relocate the Flask app to project root

**Files:**
- Delete: `main.go`, `go.mod`, `go.sum`, `heros-journey` (compiled binary)
- Delete: `heros_journey/` (entire directory — Textual TUI package)
- Delete: `main.py`, `requirements.txt` (root — Textual's `main.py`/`requirements.txt`, being replaced by the Flask ones)
- Delete: `grid-prototype.html`
- Delete: `.venv/` (root), `heros-journey-web/.venv/`, `heros-journey-web/__pycache__/`
- Move: `heros-journey-web/app.py` → `app.py`
- Move: `heros-journey-web/models.py` → `models.py`
- Move: `heros-journey-web/requirements.txt` → `requirements.txt`
- Move: `heros-journey-web/static/` → `static/`
- Delete: `heros-journey-web/` (now empty)
- Modify: `README.md`

**Interfaces:**
- Produces: `app.py` at project root, importing `from models import ...` (same relative import as before — works because `models.py` sits next to it). Flask serves `static/` from the same directory, unchanged (`Flask(__name__, static_folder="static")`).

- [ ] **Step 1: Delete the Go implementation**

```bash
cd /Users/amandachappell/Development/heros-journey-tui
rm -f main.go go.mod go.sum heros-journey
```

- [ ] **Step 2: Delete the Textual TUI implementation**

```bash
rm -rf heros_journey main.py requirements.txt
```

- [ ] **Step 3: Delete the disconnected static prototype and stray venvs/caches**

```bash
rm -f grid-prototype.html
rm -rf .venv heros-journey-web/.venv heros-journey-web/__pycache__
```

- [ ] **Step 4: Relocate the Flask app to project root**

```bash
mv heros-journey-web/app.py app.py
mv heros-journey-web/models.py models.py
mv heros-journey-web/requirements.txt requirements.txt
mv heros-journey-web/static static
rmdir heros-journey-web
```

- [ ] **Step 5: Verify the relocated app boots and serves the API**

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py &
sleep 1
curl -s http://127.0.0.1:5001/api/stages | head -c 200
kill %1
```

Expected: the `curl` output is a JSON array starting with `[{"key":"ordinary_world","title":"1. Ordinary World"`. (The `static/index.html`/`app.js` this serves is still the old modal-editor version at this point — that's expected, Tasks 2-4 replace it.)

- [ ] **Step 6: Rewrite README.md to describe the current project**

```markdown
# Hero's Journey Builder

A web app for drafting a story stage by stage through the 12-stage Hero's
Journey (Vogler's adaptation of Campbell's monomyth).

All 12 stages are visible at once in a grid. Focusing a stage — by clicking
it or selecting it with arrow keys and pressing Enter — expands it in place:
the other stages shrink to a compact strip while the focused stage shows its
full prompt and an editable text area.

## Setup

\```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
\```

## Run

\```bash
python app.py
\```

Then open http://127.0.0.1:5001 in a browser.

Stories autosave to `~/Documents/HeroJourneyStories/story.json`.

## Keybindings

| Key             | Action                                        |
|-----------------|------------------------------------------------|
| `↑` `↓` `←` `→` | Move the selection cursor (grid view)          |
| `Enter` / click | Focus the selected/clicked stage               |
| `Esc`           | Save and collapse the focused stage            |
| `⌘/Ctrl+S`      | Save the focused stage without collapsing      |

## Project layout

\```
app.py         — Flask app: serves the frontend, exposes the story API
models.py      — the 12 stage templates + StoryProject (save/load as JSON)
static/
  index.html   — page shell
  app.js       — grid state, rendering, keyboard nav, save
  style.css    — grid layout and the collapsed/idle/focused card states
\```

## Possible next steps

- Editable story/project title (currently fixed as "Untitled Story")
- Export to Markdown
- Multiple saved stories with a picker on launch
- Per-stage target word counts / progress bar
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
Delete dead Go/Textual implementations, relocate Flask app to root

Three implementations of the same idea existed in parallel. Per
docs/superpowers/specs/2026-07-15-focus-grid-web-design.md, the Flask
backend is the one worth keeping; everything else is dead weight.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Rewrite the page shell (`static/index.html`)

**Files:**
- Modify: `static/index.html` (full rewrite)

**Interfaces:**
- Produces: a `<div id="grid">` container and a `<div id="status-bar">` element that `app.js` (Task 4) populates. Loads `style.css` and `app.js`.

- [ ] **Step 1: Replace `static/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Hero's Journey</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <h1>HERO'S JOURNEY</h1>
  <div class="status-bar" id="status-bar">0/12 stages complete</div>
  <div class="grid" id="grid"></div>
  <p class="instructions">Click a stage to focus · Esc to save and collapse · ⌘/Ctrl+S to save</p>
  <script src="app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Verify it loads (will show an empty grid until Task 4 lands)**

```bash
cd /Users/amandachappell/Development/heros-journey-tui
source .venv/bin/activate
python app.py &
sleep 1
curl -s http://127.0.0.1:5001/ | grep -o '<div class="grid" id="grid"></div>'
kill %1
```

Expected: prints `<div class="grid" id="grid"></div>`.

- [ ] **Step 3: Commit**

```bash
git add static/index.html
git commit -m "$(cat <<'EOF'
Rewrite index.html as a bare grid shell

Drops the modal-editor markup; the grid itself now hosts the
collapsed/idle/focused card states directly, built in Task 4.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Rewrite the grid/card styles (`static/style.css`)

**Files:**
- Modify: `static/style.css` (full rewrite)

**Interfaces:**
- Consumes: nothing (pure CSS).
- Produces: `.grid`, `.stage`, `.stage.idle`, `.stage.collapsed`, `.stage.focused`, `.stage.selected`, `.stage-header`, `.stage-num`, `.stage-title`, `.stage-prompt`, `.stage-summary`, `.stage-editor`, `.stage-footer`, `.stage-words`, `.status-dot` (+ `.started`/`.done` modifiers) — class names `app.js` (Task 4) will attach.

- [ ] **Step 1: Replace `static/style.css`**

```css
* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background: #0a0a0f;
  color: #e0e0e0;
  min-height: 100vh;
  padding: 2rem;
}

h1 {
  text-align: center;
  font-size: 1.5rem;
  font-weight: 300;
  letter-spacing: 0.1em;
  margin-bottom: 0.5rem;
  color: #888;
}

.status-bar {
  text-align: center;
  font-size: 0.8rem;
  color: #666;
  margin-bottom: 1.5rem;
}

.grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  grid-auto-rows: minmax(120px, auto);
  gap: 8px;
  max-width: 1100px;
  margin: 0 auto;
}

.stage {
  background: #15151f;
  border: 1px solid #252530;
  border-radius: 8px;
  padding: 1rem;
  cursor: pointer;
  transition: all 0.35s cubic-bezier(0.4, 0, 0.2, 1);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.stage:hover { border-color: #3b82f6; }

.stage.selected { border-color: #3b82f6; }

.stage-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.4rem;
}

.stage-num {
  font-size: 0.65rem;
  font-weight: 600;
  color: #3b82f6;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.status-dot { width: 6px; height: 6px; border-radius: 50%; background: #333; }
.status-dot.started { background: #f59e0b; }
.status-dot.done { background: #10b981; }

.stage.idle .stage-title {
  font-size: 0.85rem;
  font-weight: 500;
  margin-bottom: 0.4rem;
  color: #d0d0d0;
}

.stage.idle .stage-prompt {
  font-size: 0.7rem;
  color: #666;
  margin-bottom: 0.5rem;
  line-height: 1.4;
}

.stage.idle .stage-summary {
  font-size: 0.7rem;
  color: #4a4a55;
  margin-top: auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stage.collapsed {
  padding: 0.5rem 0.75rem;
  opacity: 0.5;
  min-height: 48px;
  justify-content: center;
}

.stage.collapsed .stage-num { font-size: 0.6rem; color: #3b82f6; }
.stage.collapsed .stage-title { font-size: 0.7rem; color: #888; }
.stage.collapsed:hover { opacity: 0.8; }

.stage.focused {
  grid-column: span 2;
  grid-row: span 2;
  background: #12121e;
  border-color: #3b82f6;
  box-shadow: 0 0 30px rgba(59, 130, 246, 0.15);
  cursor: default;
}

.stage.focused .stage-title { font-size: 1.1rem; margin-bottom: 0.5rem; color: #fff; }
.stage.focused .stage-prompt { font-size: 0.85rem; color: #888; margin-bottom: 0.75rem; line-height: 1.5; }

.stage-editor {
  flex: 1;
  min-height: 140px;
  background: #0d0d15;
  border: 1px solid #252530;
  border-radius: 6px;
  color: #e0e0e0;
  font-family: inherit;
  font-size: 0.85rem;
  padding: 0.75rem;
  resize: none;
}

.stage-editor:focus { outline: none; border-color: #3b82f6; }

.stage-footer { margin-top: 0.5rem; font-size: 0.7rem; color: #555; }

.instructions {
  text-align: center;
  margin-top: 1.5rem;
  font-size: 0.75rem;
  color: #444;
  letter-spacing: 0.05em;
}
```

- [ ] **Step 2: Commit**

```bash
git add static/style.css
git commit -m "$(cat <<'EOF'
Rewrite style.css for collapsed/idle/focused card states

Ports grid-prototype.html's expand-in-place transition and adds the
compact .collapsed variant and .stage-summary truncation the design
spec calls for.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Rewrite the grid state and interaction logic (`static/app.js`)

**Files:**
- Modify: `static/app.js` (full rewrite)

**Interfaces:**
- Consumes: `GET /api/stages` → `[{key, title, prompt}, ...]`; `GET /api/story` → `{title, stages: {key: {key, content, wordCount, status}}, completedCount, lastSaved}`; `PUT /api/story/stage/<key>` with body `{content}` → `{ok, key, wordCount, status, lastSaved}`.
- Produces: renders into `#grid` and `#status-bar` from Task 2's `index.html`, using class names from Task 3's `style.css`.

- [ ] **Step 1: Replace `static/app.js`**

```js
let stages = [];
let focusedKey = null;
let selectedIdx = 0;

const grid = document.getElementById("grid");
const statusBar = document.getElementById("status-bar");

async function init() {
  const [stagesRes, storyRes] = await Promise.all([
    fetch("/api/stages"),
    fetch("/api/story"),
  ]);
  const templates = await stagesRes.json();
  const story = await storyRes.json();

  stages = templates.map((t, i) => {
    const saved = story.stages?.[t.key] || {};
    return {
      key: t.key,
      num: String(i + 1),
      title: t.title,
      prompt: t.prompt,
      content: saved.content || "",
      wordCount: saved.wordCount || 0,
      status: saved.status || "empty",
    };
  });

  render();
  updateStatusBar(story.completedCount || 0);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function summaryLine(content) {
  const trimmed = content.trim();
  if (!trimmed) return "—";
  const words = trimmed.split(/\s+/);
  const preview = words.slice(0, 12).join(" ");
  return escapeHtml(preview) + (words.length > 12 ? "…" : "");
}

function cardState(idx) {
  if (focusedKey === null) return "idle";
  return stages[idx].key === focusedKey ? "focused" : "collapsed";
}

function render() {
  grid.innerHTML = "";

  stages.forEach((s, i) => {
    const state = cardState(i);
    const el = document.createElement("div");
    el.className = `stage ${state}` + (focusedKey === null && i === selectedIdx ? " selected" : "");
    el.dataset.key = s.key;
    el.dataset.index = String(i);

    if (state === "collapsed") {
      el.innerHTML = `
        <div class="stage-num">${s.num}</div>
        <div class="stage-title">${s.title}</div>
      `;
    } else if (state === "idle") {
      el.innerHTML = `
        <div class="stage-header">
          <div class="stage-num">${s.num}</div>
          <span class="status-dot ${s.status}"></span>
        </div>
        <div class="stage-title">${s.title}</div>
        <div class="stage-prompt">${s.prompt}</div>
        <div class="stage-summary">${summaryLine(s.content)}</div>
      `;
    } else {
      el.innerHTML = `
        <div class="stage-header">
          <div class="stage-num">${s.num}</div>
          <span class="status-dot ${s.status}"></span>
        </div>
        <div class="stage-title">${s.title}</div>
        <div class="stage-prompt">${s.prompt}</div>
        <textarea class="stage-editor" placeholder="Begin your story here..."></textarea>
        <div class="stage-footer"><span class="stage-words">${s.wordCount} words</span></div>
      `;
      const textarea = el.querySelector(".stage-editor");
      textarea.value = s.content;
      textarea.addEventListener("input", () => {
        const words = textarea.value.trim() ? textarea.value.trim().split(/\s+/).length : 0;
        el.querySelector(".stage-words").textContent = `${words} word${words !== 1 ? "s" : ""}`;
      });
      textarea.addEventListener("blur", () => saveFocusedStage(false));
    }

    el.addEventListener("click", () => {
      if (focusedKey === null) {
        focusStage(s.key, i);
      } else if (s.key === focusedKey) {
        collapseFocused();
      }
    });

    grid.appendChild(el);
  });

  if (focusedKey !== null) {
    const textarea = grid.querySelector(".stage.focused .stage-editor");
    if (textarea) textarea.focus();
  }
}

function focusStage(key, idx) {
  focusedKey = key;
  selectedIdx = idx;
  render();
}

function collapseFocused() {
  saveFocusedStage(true);
}

async function saveFocusedStage(thenCollapse) {
  if (focusedKey === null) return;

  const textarea = grid.querySelector(".stage.focused .stage-editor");
  if (!textarea) {
    if (thenCollapse) {
      focusedKey = null;
      render();
    }
    return;
  }

  const content = textarea.value;
  const stage = stages.find((s) => s.key === focusedKey);

  if (stage.content === content) {
    if (thenCollapse) {
      focusedKey = null;
      render();
    }
    return;
  }

  const res = await fetch(`/api/story/stage/${focusedKey}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  const result = await res.json();

  if (result.ok) {
    stage.content = content;
    stage.wordCount = result.wordCount;
    stage.status = result.status;
    updateStatusBar(stages.filter((s) => s.status === "done").length);
  }

  if (thenCollapse) {
    focusedKey = null;
  }
  render();
}

function updateStatusBar(count) {
  statusBar.textContent = count === 12 ? "12/12 — all complete!" : `${count}/12 stages complete`;
}

document.addEventListener("keydown", (e) => {
  if (focusedKey !== null) {
    if (e.key === "Escape") {
      e.preventDefault();
      collapseFocused();
    } else if (e.key === "s" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      saveFocusedStage(false);
    }
    return;
  }

  if (e.key === "ArrowRight") {
    e.preventDefault();
    selectedIdx = Math.min(selectedIdx + 1, stages.length - 1);
    render();
  }
  if (e.key === "ArrowLeft") {
    e.preventDefault();
    selectedIdx = Math.max(selectedIdx - 1, 0);
    render();
  }
  if (e.key === "ArrowDown") {
    e.preventDefault();
    selectedIdx = Math.min(selectedIdx + 4, stages.length - 1);
    render();
  }
  if (e.key === "ArrowUp") {
    e.preventDefault();
    selectedIdx = Math.max(selectedIdx - 4, 0);
    render();
  }
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    focusStage(stages[selectedIdx].key, selectedIdx);
  }
});

init();
```

- [ ] **Step 2: Commit**

```bash
git add static/app.js
git commit -m "$(cat <<'EOF'
Rewrite app.js for in-place focus/collapse instead of a modal

Single focusedKey drives three card states (collapsed/idle/focused).
Textarea content is set via .value, never interpolated into
innerHTML, so story text containing '</textarea>' or script-like
content can't break the page.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: End-to-end manual verification

**Files:** none (verification only).

**Interfaces:** none.

- [ ] **Step 1: Start the app**

```bash
cd /Users/amandachappell/Development/heros-journey-tui
source .venv/bin/activate
python app.py
```

- [ ] **Step 2: Open http://127.0.0.1:5001 in a browser and verify the idle grid**

Expected: 12 cards in a 4×3 grid, each showing number, title, prompt, a `—` summary line (no saved content yet), and a gray status dot.

- [ ] **Step 3: Click "Ordinary World" and verify it focuses**

Expected: the clicked card grows to span 2×2, shows the full prompt and an empty textarea (autofocused, cursor ready to type), and the other 11 cards shrink to a compact title-only strip.

- [ ] **Step 4: Type a sentence, press Esc, and verify it collapses and saves**

Expected: card returns to idle size; its `.stage-summary` now shows the words you typed (truncated at 12 words with `…` if longer); status dot is gray if <1 word counted as empty, amber if under 50 words.

- [ ] **Step 5: Reload the page and verify persistence**

Expected: the same stage's idle-state summary still shows your typed text after a full page reload — confirms the `PUT /api/story/stage/<key>` round-trip and `GET /api/story` merge both work.

- [ ] **Step 6: Verify keyboard-only flow**

Expected: with nothing focused, arrow keys move a blue-outlined `.selected` card around the grid (including wrapping correctly at row edges via `ArrowDown`/`ArrowUp` ±4); `Enter` focuses the selected card; `Esc` saves and collapses back to grid with the same card still selected.

- [ ] **Step 7: Stop the server**

```bash
# Ctrl+C in the terminal running `python app.py`
```

- [ ] **Step 8: Final commit if any fixes were needed during verification**

If Steps 2-6 all passed with no code changes, skip this step. Otherwise, stage and commit whatever fix was required with a message describing the bug found during verification.
