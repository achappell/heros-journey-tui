# Story Logging & Export Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build passive Q&A logging, export panel (debug JSON + story Q&A markdown/text), and story view side panel with editable content.

**Architecture:** Logging happens passively during guided Q&A flows, stored in-memory during session. Export panel provides four buttons (download/copy for debug log and story Q&A). Story View panel slides in from right, shows all stages in reading order with editable content.

**Tech Stack:** Vanilla JavaScript (no new dependencies), HTML5 Blob/File API for downloads, Clipboard API for copy-to-clipboard.

## Global Constraints

- No new npm dependencies
- Backward compatible with existing API endpoints
- Logs stored in-memory during session (no server persistence for MVP)
- Export formats: debug log = JSON, story Q&A = Markdown or plain text (user selects)
- Story View side panel: read-only or editable mode (user can toggle or edit by default — tbd with user)

---

## Task 1: Add Logging Infrastructure to App State

**Files:**
- Modify: `static/app.js` (globals section, around line 1-10)

**Interfaces:**
- Produces: `window.storyLogs` object structured as `{ stage_key: { sessions: [] } }`
- Produces: `logGuidedSession(stageKey, sessionData)` function

**Steps:**

- [ ] **Step 1: Add globals to track logging state**

After the existing globals (`let stages = []`, `let focusedKey = null`, etc.), add:

```javascript
let storyLogs = {};  // { stage_key: { sessions: [...] } }

function initStoryLogs() {
  stages.forEach(stage => {
    storyLogs[stage.key] = { sessions: [] };
  });
}
```

- [ ] **Step 2: Call initStoryLogs in init()**

In the `init()` function after `stages = templates.map(...)`, add:

```javascript
initStoryLogs();
```

- [ ] **Step 3: Add logGuidedSession function**

After the `initStoryLogs()` function, add:

```javascript
function logGuidedSession(stageKey, sessionData) {
  if (!storyLogs[stageKey]) {
    storyLogs[stageKey] = { sessions: [] };
  }
  storyLogs[stageKey].sessions.push({
    session_id: `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    started_at: sessionData.started_at,
    completed_at: new Date().toISOString(),
    model: sessionData.model,
    generation_times_ms: sessionData.generation_times_ms,
    questions: sessionData.questions,
    q_and_a: sessionData.q_and_a,
    final_woven_content: sessionData.final_woven_content
  });
}
```

- [ ] **Step 4: Test by opening browser console**

Open http://127.0.0.1:5001, open browser DevTools, and verify `window.storyLogs` exists:

```javascript
console.log(window.storyLogs);
// Expected: { ordinary_world: { sessions: [] }, call_to_adventure: { sessions: [] }, ... }
```

- [ ] **Step 5: Commit**

```bash
git add static/app.js
git commit -m "feat: add logging infrastructure and storyLogs global state"
```

---

## Task 2: Capture Guided Session Data During Q&A Flow

**Files:**
- Modify: `static/app.js` (guided questions flow, around line 370-400)

**Interfaces:**
- Consumes: `logGuidedSession(stageKey, sessionData)` from Task 1
- Consumes: existing `guidedState` object
- Produces: enhanced `guidedState` with timestamps and model tracking

**Steps:**

- [ ] **Step 1: Enhance guidedState initialization**

Find the line where `guidedState` is initialized (currently around line 374):

```javascript
guidedState = { loading: true, questions: [], q_and_a: [], idx: 0, suggestion: null, error: null, fetchingBackground: false, waitingForMore: false, noMoreQuestions: false };
```

Replace with:

```javascript
const sessionStartTime = new Date().toISOString();
guidedState = { 
  loading: true, 
  questions: [], 
  q_and_a: [], 
  idx: 0, 
  suggestion: null, 
  error: null, 
  fetchingBackground: false, 
  waitingForMore: false, 
  noMoreQuestions: false,
  sessionStartTime,
  model: 'mimo-v2.5',  // default, can be overridden by form
  generationTimes: { questions: 0, weave: 0 },
  currentStageKey: null
};
```

- [ ] **Step 2: Capture model name from form**

Find where the AI client is called to generate questions (around line 379). Before the call:

```javascript
// Get model from form if available, else default
const modelSelect = document.querySelector('select[name="model"]') || {};
guidedState.model = modelSelect.value || 'mimo-v2.5';
guidedState.currentStageKey = stage.key;
```

- [ ] **Step 3: Capture generation time for questions**

After the questions are received (around line 382 where `guidedState.questions = questions`), add:

```javascript
const questionGenStart = performance.now();
const questions = await AIClient.generateQuestions(stage.prompt, storySoFar, []);
guidedState.generationTimes.questions = Math.round(performance.now() - questionGenStart);
```

Actually, this needs to be restructured. Let me refine:

Find the section where questions are generated (line 378-382). Replace:

```javascript
const questions = await AIClient.generateQuestions(stage.prompt, storySoFar, []);
```

With:

```javascript
const questionGenStart = performance.now();
const questions = await AIClient.generateQuestions(stage.prompt, storySoFar, []);
guidedState.generationTimes.questions = Math.round(performance.now() - questionGenStart);
```

- [ ] **Step 4: Capture generation time for weave**

Find the weave call (around line 380 where `AIClient.weaveAnswers` is called). Replace:

```javascript
const suggestion = await AIClient.weaveAnswers(stage.prompt, storySoFar, guidedState.q_and_a, ...);
```

With:

```javascript
const weaveStart = performance.now();
const suggestion = await AIClient.weaveAnswers(stage.prompt, storySoFar, guidedState.q_and_a, ...);
guidedState.generationTimes.weave = Math.round(performance.now() - weaveStart);
```

- [ ] **Step 5: Log session when completed**

After the weave is complete and `guidedState.suggestion` is set, call logGuidedSession. Find where the user accepts the suggestion (around line 288):

```javascript
// After setting content from suggestion
const content = guidedState.suggestion;
// ... save content ...
logGuidedSession(guidedState.currentStageKey, {
  started_at: guidedState.sessionStartTime,
  model: guidedState.model,
  generation_times_ms: guidedState.generationTimes,
  questions: guidedState.questions,
  q_and_a: guidedState.q_and_a,
  final_woven_content: content
});
guidedState = null;
```

- [ ] **Step 6: Test by running through full Q&A flow**

1. Open app
2. Click on a stage
3. Click "Ask Guiding Questions"
4. Answer all questions and weave
5. Open DevTools console: `console.log(window.storyLogs)`
6. Verify the session was logged with all metadata

- [ ] **Step 7: Commit**

```bash
git add static/app.js
git commit -m "feat: capture guided session metadata (model, timestamps, generation times)"
```

---

## Task 3: Add Export Panel UI and Header Buttons

**Files:**
- Modify: `static/index.html` (header section)
- Modify: `static/app.js` (new UI rendering)
- Modify: `static/style.css` (new styles)

**Interfaces:**
- Consumes: `window.storyLogs` from Task 1
- Produces: `showExportPanel()` function
- Produces: `closeExportPanel()` function

**Steps:**

- [ ] **Step 1: Add buttons to HTML header**

Find the header section in `static/index.html` (around line with `<header>` or similar). Add two buttons to the top-right:

```html
<header>
  <!-- existing header content -->
  <div class="header-buttons">
    <button id="view-story-btn" class="header-btn" title="View complete story">📖 View Story</button>
    <button id="export-btn" class="header-btn" title="Export logs and story">⤓ Export</button>
  </div>
</header>
```

- [ ] **Step 2: Create export panel HTML**

After the `<header>`, add an export panel div (before `<main id="grid">`):

```html
<div id="export-panel" class="export-panel hidden">
  <div class="export-panel-content">
    <h3>Export Story</h3>
    
    <div class="export-section">
      <h4>Debug Log (JSON)</h4>
      <p>All Q&A sessions with timestamps, model, and generation times</p>
      <div class="export-buttons">
        <button class="export-btn" id="export-debug-download">⬇ Download JSON</button>
        <button class="export-btn" id="export-debug-copy">📋 Copy to Clipboard</button>
      </div>
    </div>
    
    <div class="export-section">
      <h4>Story Q&A</h4>
      <p>Questions and answers per stage</p>
      <div class="export-format">
        <label>
          <input type="radio" name="qa-format" value="markdown" checked> Markdown
        </label>
        <label>
          <input type="radio" name="qa-format" value="plaintext"> Plain Text
        </label>
      </div>
      <div class="export-buttons">
        <button class="export-btn" id="export-qa-download">⬇ Download Q&A</button>
        <button class="export-btn" id="export-qa-copy">📋 Copy to Clipboard</button>
      </div>
    </div>
    
    <button class="export-close-btn" id="export-close-btn">✕</button>
  </div>
</div>
```

- [ ] **Step 3: Add CSS for export panel**

Add to `static/style.css`:

```css
.header-buttons {
  display: flex;
  gap: 8px;
}

.header-btn {
  padding: 6px 12px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  transition: background 0.2s;
}

.header-btn:hover {
  background: var(--bg-tertiary);
}

.export-panel {
  position: fixed;
  top: 0;
  right: 0;
  width: 40%;
  height: 100vh;
  background: var(--bg-primary);
  border-left: 1px solid var(--border-color);
  box-shadow: -4px 0 12px rgba(0, 0, 0, 0.1);
  z-index: 100;
  display: flex;
  flex-direction: column;
  transition: transform 0.3s ease;
}

.export-panel.hidden {
  transform: translateX(100%);
  pointer-events: none;
}

.export-panel-content {
  padding: 24px;
  overflow-y: auto;
  flex: 1;
  position: relative;
}

.export-section {
  margin-bottom: 24px;
}

.export-section h4 {
  margin: 0 0 8px 0;
  font-size: 14px;
  font-weight: 600;
}

.export-section p {
  margin: 0 0 12px 0;
  font-size: 12px;
  color: var(--text-secondary);
}

.export-format {
  display: flex;
  gap: 16px;
  margin-bottom: 12px;
}

.export-format label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}

.export-buttons {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.export-btn {
  padding: 8px 12px;
  background: var(--accent-color);
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  transition: background 0.2s;
}

.export-btn:hover {
  opacity: 0.9;
}

.export-close-btn {
  position: absolute;
  top: 12px;
  right: 12px;
  width: 32px;
  height: 32px;
  background: transparent;
  border: none;
  font-size: 18px;
  cursor: pointer;
  color: var(--text-primary);
}

.export-close-btn:hover {
  opacity: 0.6;
}

#grid.export-open {
  filter: brightness(0.7);
  pointer-events: none;
}
```

- [ ] **Step 4: Add event listeners in app.js**

Add to the `init()` function after `initThemeToggle()`:

```javascript
document.getElementById('export-btn').addEventListener('click', showExportPanel);
document.getElementById('export-close-btn').addEventListener('click', closeExportPanel);
document.getElementById('export-debug-download').addEventListener('click', downloadDebugLog);
document.getElementById('export-debug-copy').addEventListener('click', copyDebugLog);
document.getElementById('export-qa-download').addEventListener('click', downloadQAExport);
document.getElementById('export-qa-copy').addEventListener('click', copyQAExport);
```

- [ ] **Step 5: Implement panel toggle functions**

Add before the `init()` function:

```javascript
function showExportPanel() {
  document.getElementById('export-panel').classList.remove('hidden');
  grid.classList.add('export-open');
}

function closeExportPanel() {
  document.getElementById('export-panel').classList.add('hidden');
  grid.classList.remove('export-open');
}
```

- [ ] **Step 6: Test panel opens/closes**

1. Open app
2. Click "⤓ Export" button
3. Verify panel slides in from right
4. Verify grid dims
5. Click close button (✕)
6. Verify panel slides out and grid returns to normal

- [ ] **Step 7: Commit**

```bash
git add static/index.html static/app.js static/style.css
git commit -m "feat: add export panel UI with header buttons"
```

---

## Task 4: Implement Debug Log Export (JSON)

**Files:**
- Modify: `static/app.js` (add export functions)

**Interfaces:**
- Consumes: `window.storyLogs` from Task 1
- Consumes: `currentStory.title` from existing app state
- Produces: `downloadDebugLog()` function
- Produces: `copyDebugLog()` function
- Produces: `generateDebugLog()` function (helper)

**Steps:**

- [ ] **Step 1: Write generateDebugLog helper**

Add before `showExportPanel()`:

```javascript
function generateDebugLog() {
  const debugLog = {
    story_title: currentStory.title,
    story_key: `story_${Date.now()}`,
    created_at: new Date().toISOString(),
    sessions: []
  };
  
  for (const [stageKey, stageLog] of Object.entries(storyLogs)) {
    const stageTemplate = stages.find(s => s.key === stageKey);
    if (stageLog.sessions.length > 0) {
      debugLog.sessions.push({
        stage_key: stageKey,
        stage_title: stageTemplate ? stageTemplate.title : stageKey,
        session_data: stageLog.sessions
      });
    }
  }
  
  return debugLog;
}
```

- [ ] **Step 2: Write downloadDebugLog function**

Add after `generateDebugLog()`:

```javascript
function downloadDebugLog() {
  const debugLog = generateDebugLog();
  const json = JSON.stringify(debugLog, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `story_${currentStory.title}_debug_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 3: Write copyDebugLog function**

Add after `downloadDebugLog()`:

```javascript
function copyDebugLog() {
  const debugLog = generateDebugLog();
  const json = JSON.stringify(debugLog, null, 2);
  navigator.clipboard.writeText(json).then(() => {
    alert('Debug log copied to clipboard!');
  }).catch(err => {
    alert('Failed to copy: ' + err.message);
  });
}
```

- [ ] **Step 4: Test download**

1. Open app
2. Run through a guided Q&A session (complete a stage)
3. Click "⤓ Export" 
4. Click "⬇ Download JSON"
5. Verify JSON file downloads with correct name and content
6. Open JSON in editor, verify structure matches spec

- [ ] **Step 5: Test copy to clipboard**

1. Click "⤓ Export"
2. Click "📋 Copy to Clipboard" (Debug Log)
3. Paste into a text editor
4. Verify JSON content is correct

- [ ] **Step 6: Commit**

```bash
git add static/app.js
git commit -m "feat: implement debug log export (JSON download and copy)"
```

---

## Task 5: Implement Story Q&A Export (Markdown/Plain Text)

**Files:**
- Modify: `static/app.js` (add export functions)

**Interfaces:**
- Consumes: `window.storyLogs` from Task 1
- Consumes: `currentStory.title` and `stages`
- Produces: `generateQAExport(format)` function (helper)
- Produces: `downloadQAExport()` function
- Produces: `copyQAExport()` function

**Steps:**

- [ ] **Step 1: Write generateQAExport helper**

Add after `copyDebugLog()`:

```javascript
function generateQAExport(format = 'markdown') {
  let output = '';
  
  if (format === 'markdown') {
    output = `# ${currentStory.title}\n\n`;
  }
  
  for (const stage of stages) {
    const stageLog = storyLogs[stage.key];
    
    if (format === 'markdown') {
      output += `## ${stage.title}\n\n`;
    } else {
      output += `${stage.title}\n${'='.repeat(stage.title.length)}\n\n`;
    }
    
    if (stageLog && stageLog.sessions.length > 0) {
      const latestSession = stageLog.sessions[stageLog.sessions.length - 1];
      for (const qa of latestSession.q_and_a) {
        if (format === 'markdown') {
          output += `**Q:** ${qa.question}\n`;
          output += `**A:** ${qa.answer}\n\n`;
        } else {
          output += `Q: ${qa.question}\n`;
          output += `A: ${qa.answer}\n\n`;
        }
      }
    } else {
      if (format === 'markdown') {
        output += `*No Q&A recorded yet.*\n\n`;
      } else {
        output += `No Q&A recorded yet.\n\n`;
      }
    }
  }
  
  return output;
}
```

- [ ] **Step 2: Write downloadQAExport function**

Add after `generateQAExport()`:

```javascript
function downloadQAExport() {
  const format = document.querySelector('input[name="qa-format"]:checked').value;
  const content = generateQAExport(format);
  const ext = format === 'markdown' ? 'md' : 'txt';
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `story_${currentStory.title}_q-and-a_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.${ext}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 3: Write copyQAExport function**

Add after `downloadQAExport()`:

```javascript
function copyQAExport() {
  const format = document.querySelector('input[name="qa-format"]:checked').value;
  const content = generateQAExport(format);
  navigator.clipboard.writeText(content).then(() => {
    alert('Q&A export copied to clipboard!');
  }).catch(err => {
    alert('Failed to copy: ' + err.message);
  });
}
```

- [ ] **Step 4: Test Markdown download**

1. Run through a guided Q&A session
2. Click "⤓ Export"
3. Ensure "Markdown" is selected
4. Click "⬇ Download Q&A"
5. Verify .md file downloads
6. Open in editor, verify format is clean Markdown

- [ ] **Step 5: Test Plain Text download**

1. Click "⤓ Export"
2. Select "Plain Text" radio button
3. Click "⬇ Download Q&A"
4. Verify .txt file downloads
5. Open in editor, verify format is clean text

- [ ] **Step 6: Test copy to clipboard**

1. Select Markdown format
2. Click "📋 Copy to Clipboard" (Story Q&A)
3. Paste into editor, verify Markdown format
4. Select Plain Text, copy again, verify format changes

- [ ] **Step 7: Commit**

```bash
git add static/app.js
git commit -m "feat: implement story Q&A export (markdown and plain text)"
```

---

## Task 6: Add Story View Panel UI

**Files:**
- Modify: `static/index.html` (add side panel HTML)
- Modify: `static/app.js` (add toggle functions)
- Modify: `static/style.css` (add styles)

**Interfaces:**
- Produces: `showStoryView()` function
- Produces: `closeStoryView()` function
- Consumes: `currentStory.stages`, `stages` from existing state

**Steps:**

- [ ] **Step 1: Add story view panel HTML**

Add to `index.html` after the export panel (before or after `<main id="grid">`):

```html
<div id="story-view-panel" class="story-view-panel hidden">
  <div class="story-view-header">
    <h2>Story View</h2>
    <button id="story-view-close-btn" class="story-view-close-btn">✕</button>
  </div>
  <div id="story-view-content" class="story-view-content">
    <!-- Populated by JavaScript -->
  </div>
</div>
```

- [ ] **Step 2: Add CSS for story view panel**

Add to `static/style.css`:

```css
.story-view-panel {
  position: fixed;
  top: 0;
  right: 0;
  width: 50%;
  height: 100vh;
  background: var(--bg-primary);
  border-left: 1px solid var(--border-color);
  box-shadow: -4px 0 12px rgba(0, 0, 0, 0.1);
  z-index: 99;
  display: flex;
  flex-direction: column;
  transition: transform 0.3s ease;
}

.story-view-panel.hidden {
  transform: translateX(100%);
  pointer-events: none;
}

.story-view-header {
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color);
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0;
}

.story-view-header h2 {
  margin: 0;
  font-size: 18px;
}

.story-view-close-btn {
  width: 32px;
  height: 32px;
  background: transparent;
  border: none;
  font-size: 18px;
  cursor: pointer;
  color: var(--text-primary);
}

.story-view-close-btn:hover {
  opacity: 0.6;
}

.story-view-content {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

.story-stage {
  margin-bottom: 32px;
}

.story-stage-title {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 12px;
}

.story-stage-content {
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-primary);
  white-space: pre-wrap;
  word-wrap: break-word;
}

#grid.story-view-open {
  filter: brightness(0.7);
  pointer-events: none;
}
```

- [ ] **Step 3: Add event listener in app.js**

Add to `init()` after export button listeners:

```javascript
document.getElementById('view-story-btn').addEventListener('click', showStoryView);
document.getElementById('story-view-close-btn').addEventListener('click', closeStoryView);
```

- [ ] **Step 4: Implement showStoryView function**

Add after the export functions:

```javascript
function showStoryView() {
  const content = document.getElementById('story-view-content');
  content.innerHTML = '';
  
  for (const stage of stages) {
    const stageDiv = document.createElement('div');
    stageDiv.className = 'story-stage';
    
    const title = document.createElement('div');
    title.className = 'story-stage-title';
    title.textContent = stage.title;
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'story-stage-content';
    contentDiv.textContent = stage.content || '(empty)';
    
    stageDiv.appendChild(title);
    stageDiv.appendChild(contentDiv);
    content.appendChild(stageDiv);
  }
  
  document.getElementById('story-view-panel').classList.remove('hidden');
  grid.classList.add('story-view-open');
}
```

- [ ] **Step 5: Implement closeStoryView function**

Add after `showStoryView()`:

```javascript
function closeStoryView() {
  document.getElementById('story-view-panel').classList.add('hidden');
  grid.classList.remove('story-view-open');
}
```

- [ ] **Step 6: Test panel opens/closes**

1. Open app
2. Click "📖 View Story" button
3. Verify panel slides in from right
4. Verify all 12 stages are displayed in reading order
5. Verify grid dims
6. Click close button (✕)
7. Verify panel slides out

- [ ] **Step 7: Test content display**

1. Fill in a stage in the grid
2. Open Story View
3. Verify the content appears in the side panel
4. Go back to grid, edit content
5. Open Story View again, verify updated content is shown

- [ ] **Step 8: Commit**

```bash
git add static/index.html static/app.js static/style.css
git commit -m "feat: add story view side panel with read-only content display"
```

---

## Task 7: Make Story View Content Editable with Autosave

**Files:**
- Modify: `static/app.js` (enhance story view rendering and save logic)
- Modify: `static/style.css` (add editable textarea styles)

**Interfaces:**
- Consumes: existing `saveStage(key, content)` logic
- Produces: enhanced `showStoryView()` with editable textareas

**Steps:**

- [ ] **Step 1: Update CSS for editable content in story view**

Add to `static/style.css`:

```css
.story-stage-content-textarea {
  width: 100%;
  min-height: 120px;
  padding: 12px;
  font-family: inherit;
  font-size: 14px;
  line-height: 1.6;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  resize: vertical;
}

.story-stage-content-textarea:focus {
  outline: none;
  border-color: var(--accent-color);
}
```

- [ ] **Step 2: Update showStoryView to use textareas**

Replace the existing `showStoryView()` function:

```javascript
function showStoryView() {
  const content = document.getElementById('story-view-content');
  content.innerHTML = '';
  
  for (const stage of stages) {
    const stageDiv = document.createElement('div');
    stageDiv.className = 'story-stage';
    
    const title = document.createElement('div');
    title.className = 'story-stage-title';
    title.textContent = stage.title;
    
    const textarea = document.createElement('textarea');
    textarea.className = 'story-stage-content-textarea';
    textarea.value = stage.content;
    textarea.dataset.stageKey = stage.key;
    
    // Auto-save on change
    textarea.addEventListener('change', async function() {
      const project = await fetch('/api/story').then(r => r.json());
      const updatedStage = project.stages[stage.key];
      updatedStage.content = this.value;
      
      // Save via existing endpoint
      const saveResp = await fetch(`/api/story/stage/${stage.key}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: this.value })
      });
      
      if (saveResp.ok) {
        // Update the stage in memory
        const idx = stages.findIndex(s => s.key === stage.key);
        if (idx >= 0) {
          stages[idx].content = this.value;
          stages[idx].wordCount = StoryStore.wordCount(this.value);
          stages[idx].status = StoryStore.stageStatus(this.value);
        }
      }
    });
    
    stageDiv.appendChild(title);
    stageDiv.appendChild(textarea);
    content.appendChild(stageDiv);
  }
  
  document.getElementById('story-view-panel').classList.remove('hidden');
  grid.classList.add('story-view-open');
}
```

- [ ] **Step 3: Test editable content in story view**

1. Open app
2. Click "📖 View Story"
3. Click in one of the textareas
4. Type some text
5. Click elsewhere to trigger autosave
6. Close the panel
7. Click "📖 View Story" again
8. Verify the text you added is still there
9. Go back to the grid, verify the stage content was updated

- [ ] **Step 4: Test that grid reflects changes**

1. Edit content in story view panel
2. Close story view
3. Click on the stage in the grid
4. Verify the grid shows the updated content

- [ ] **Step 5: Commit**

```bash
git add static/app.js static/style.css
git commit -m "feat: make story view content editable with autosave"
```

---

## Task 8: Manual Testing & Edge Cases

**Files:**
- No new files (testing only)

**Steps:**

- [ ] **Step 1: Test full workflow**

1. Open app
2. Fill out all 12 stages (mix of manual content and guided Q&A)
3. For at least 3 stages, run the guided questions flow
4. Open Story View, verify all content is there
5. Edit one stage in Story View
6. Close and verify changes persisted
7. Open Export panel, download both formats (JSON debug log and Markdown Q&A)
8. Open Export panel, copy both formats to clipboard
9. Verify all exports are properly formatted

- [ ] **Step 2: Test empty stages**

1. Leave some stages empty
2. Open Story View
3. Verify empty stages show "(empty)" or blank textarea
4. Open exports, verify empty stages handled gracefully

- [ ] **Step 3: Test with no Q&A sessions**

1. Close and restart the app
2. Open Story View (no Q&A sessions yet)
3. Click Export
4. Try to download debug log
5. Verify it shows empty sessions array

- [ ] **Step 4: Test across browser close/reopen**

1. Complete a guided Q&A session
2. Export to verify logging worked
3. Close browser entirely
4. Reopen http://127.0.0.1:5001
5. Verify story content persisted (it should, via story.json)
6. Note: logs are in-memory, so they'll be lost on page refresh (acceptable for MVP)

- [ ] **Step 5: Test responsive sizing**

1. Resize browser to mobile width (375px)
2. Open Story View panel
3. Verify it still works (width should be responsive)
4. Verify text is readable and textareas are usable
5. Test Export panel on mobile width too

- [ ] **Step 6: Test keyboard navigation (optional)**

1. Tab through export buttons
2. Verify they're all reachable
3. Verify Enter/Space triggers clicks

- [ ] **Step 7: Create a summary document**

Create a test results summary documenting:
- What was tested
- What passed
- Any issues found
- Whether ready for release

Save as: `TEST_RESULTS.md` in project root

---

## Summary Checklist

- [ ] Logging infrastructure captures all metadata (Task 1-2)
- [ ] Export panel UI is functional (Task 3)
- [ ] Debug log exports as JSON with download + copy (Task 4)
- [ ] Story Q&A exports as Markdown/text with download + copy (Task 5)
- [ ] Story View side panel displays all stages read-only (Task 6)
- [ ] Story View content is editable with autosave (Task 7)
- [ ] Full workflow tested end-to-end (Task 8)
- [ ] All commits made with clear messages
- [ ] No breaking changes to existing features

---

## Spec Coverage Verification

**Logging (Spec: "Every guided Q&A session is logged")** → Tasks 1-2 ✓  
**Debug Log Export (Spec: JSON download + copy)** → Task 4 ✓  
**Story Q&A Export (Spec: Markdown/text download + copy)** → Task 5 ✓  
**Story View Panel (Spec: Side panel, all stages, editable)** → Tasks 6-7 ✓  
**Auto-save (Spec: Edits persist)** → Task 7 ✓  
**UI Placement (Spec: Header buttons, side panel overlay)** → Tasks 3, 6 ✓  

All spec requirements covered. No gaps identified.

