let stages = [];
let focusedKey = null;
let selectedIdx = 0;
let guidedState = null;
let guidedGeneration = 0;
let currentStory = null;

let storyLogs = {};  // { stage_key: { sessions: [...] } }

const STORY_LOGS_KEY = "hj_story_logs";

const grid = document.getElementById("grid");
const statusBar = document.getElementById("status-bar");

function initStoryLogs() {
  const raw = localStorage.getItem(STORY_LOGS_KEY);
  let parsed = null;
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      parsed = null;
    }
  }
  storyLogs = parsed || {};
  stages.forEach(stage => {
    if (!storyLogs[stage.key]) {
      storyLogs[stage.key] = { sessions: [] };
    }
  });
}

function saveStoryLogs() {
  localStorage.setItem(STORY_LOGS_KEY, JSON.stringify(storyLogs));
}

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
  saveStoryLogs();
}

async function init() {
  const stagesRes = await fetch("data/stages.json");
  const templates = await stagesRes.json();
  currentStory = StoryStore.load(templates);
  Settings.save({ ageRange: currentStory.ageRange });

  stages = templates.map((t, i) => {
    const content = currentStory.stages[t.key].content;
    return {
      key: t.key,
      title: t.title,
      prompt: t.prompt,
      content,
      wordCount: StoryStore.wordCount(content),
      status: StoryStore.stageStatus(content),
    };
  });

  initStoryLogs();

  render();
  updateStatusBar(StoryStore.completedCount(currentStory));
  initSettingsPanel();
  initThemeToggle();

  document.getElementById('logs-export-btn').addEventListener('click', showExportPanel);
  document.getElementById('export-close-btn').addEventListener('click', closeExportPanel);
  document.getElementById('view-story-btn').addEventListener('click', showStoryView);
  document.getElementById('story-view-close-btn').addEventListener('click', closeStoryView);
  document.getElementById('export-debug-download').addEventListener('click', downloadDebugLog);
  document.getElementById('export-debug-copy').addEventListener('click', copyDebugLog);
  document.getElementById('export-qa-download').addEventListener('click', downloadQAExport);
  document.getElementById('export-qa-copy').addEventListener('click', copyQAExport);
  document.getElementById('export-story-download').addEventListener('click', downloadStoryExport);
  document.getElementById('export-story-copy').addEventListener('click', copyStoryExport);
}

function showExportPanel() {
  document.getElementById('export-panel').classList.remove('hidden');
  grid.classList.add('export-open');
}

function closeExportPanel() {
  document.getElementById('export-panel').classList.add('hidden');
  grid.classList.remove('export-open');
}

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

    let flushSaveTimeout = null;
    const flushTextarea = () => {
      clearTimeout(flushSaveTimeout);
      saveStageContent(stage.key, textarea.value);
    };
    textarea.addEventListener('input', () => {
      clearTimeout(flushSaveTimeout);
      flushSaveTimeout = setTimeout(() => saveStageContent(stage.key, textarea.value), 500);
    });
    textarea.addEventListener('blur', flushTextarea);

    stageDiv.appendChild(title);
    stageDiv.appendChild(textarea);
    content.appendChild(stageDiv);
  }

  document.getElementById('story-view-panel').classList.remove('hidden');
  grid.classList.add('story-view-open');
}

function closeStoryView() {
  document.getElementById('story-view-panel').classList.add('hidden');
  grid.classList.remove('story-view-open');
}

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

function copyDebugLog() {
  const debugLog = generateDebugLog();
  const json = JSON.stringify(debugLog, null, 2);
  navigator.clipboard.writeText(json).then(() => {
    alert('Debug log copied to clipboard!');
  }).catch(err => {
    alert('Failed to copy: ' + err.message);
  });
}

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
          output += `**Q:** ${qa.q}\n`;
          output += `**A:** ${qa.a}\n\n`;
        } else {
          output += `Q: ${qa.q}\n`;
          output += `A: ${qa.a}\n\n`;
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

function copyQAExport() {
  const format = document.querySelector('input[name="qa-format"]:checked').value;
  const content = generateQAExport(format);
  navigator.clipboard.writeText(content).then(() => {
    alert('Q&A export copied to clipboard!');
  }).catch(err => {
    alert('Failed to copy: ' + err.message);
  });
}

function generateStoryExport(format = 'markdown') {
  let output = '';

  if (format === 'markdown') {
    output = `# ${currentStory.title}\n\n`;
  }

  for (const stage of stages) {
    if (format === 'markdown') {
      output += `## ${stage.title}\n\n`;
    } else {
      output += `${stage.title}\n${'='.repeat(stage.title.length)}\n\n`;
    }

    if (stage.content && stage.content.trim()) {
      output += `${stage.content.trim()}\n\n`;
    } else {
      if (format === 'markdown') {
        output += `*No content yet.*\n\n`;
      } else {
        output += `No content yet.\n\n`;
      }
    }
  }

  return output;
}

function downloadStoryExport() {
  const format = document.querySelector('input[name="story-format"]:checked').value;
  const content = generateStoryExport(format);
  const ext = format === 'markdown' ? 'md' : 'txt';
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `story_${currentStory.title}_full_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.${ext}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function copyStoryExport() {
  const format = document.querySelector('input[name="story-format"]:checked').value;
  const content = generateStoryExport(format);
  navigator.clipboard.writeText(content).then(() => {
    alert('Story export copied to clipboard!');
  }).catch(err => {
    alert('Failed to copy: ' + err.message);
  });
}

function initThemeToggle() {
  const btn = document.getElementById("theme-toggle");
  const applyIcon = () => {
    const isLight = document.documentElement.getAttribute("data-theme") === "light";
    btn.textContent = isLight ? "☀️" : "🌙";
  };
  applyIcon();
  btn.addEventListener("click", () => {
    const isLight = document.documentElement.getAttribute("data-theme") === "light";
    const next = isLight ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("hj_theme", next);
    applyIcon();
  });
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
        <div class="stage-title">${s.title}</div>
      `;
    } else if (state === "idle") {
      el.innerHTML = `
        <div class="stage-header">
          <span class="status-dot ${s.status}"></span>
        </div>
        <div class="stage-title">${s.title}</div>
        <div class="stage-prompt">${s.prompt}</div>
        <div class="stage-summary">${summaryLine(s.content)}</div>
      `;
    } else {
      let bodyHtml = '';
      if (s.content && !guidedState) {
        bodyHtml = `
          <textarea class="stage-editor content-editor">${escapeHtml(s.content)}</textarea>
          <div class="stage-footer">
            <div class="footer-row">
              <span class="stage-words">${s.wordCount} words</span>
              ${i < stages.length - 1 ? '<button class="next-btn">Next →</button>' : ''}
            </div>
            <div class="footer-row">
              <button class="ai-btn redo-guided-btn">Rewrite with Guided Flow</button>
            </div>
          </div>
        `;
      } else if (!guidedState) {
        bodyHtml = `
          <div class="empty-stage-prompt">
            <p class="empty-hint">No content yet for this stage.</p>
            <button class="ai-btn start-guided-btn">Start Guided Flow</button>
          </div>
        `;
      } else {
        if (guidedState.error) {
          bodyHtml = `
            <div class="guided-flow">
              <div class="preview-error">${escapeHtml(guidedState.error)}</div>
              <button class="ai-btn retry-btn">Retry</button>
            </div>
          `;
        } else if (guidedState.loading) {
          bodyHtml = `<div class="guided-flow"><div class="guided-loading">AI is thinking...</div></div>`;
        } else if (currentSuggestion()) {
          bodyHtml = `
            <div class="guided-flow">
              <div class="preview-block">
                <div class="preview-text">${escapeHtml(currentSuggestion())}</div>
                <div class="preview-actions">
                  <button class="action-btn accept">Accept</button>
                  <button class="action-btn reject">Reject</button>
                </div>
              </div>
            </div>
          `;
        } else if (guidedState.questions && guidedState.questions.length > 0 && guidedState.idx < guidedState.questions.length) {
          const q = guidedState.questions[guidedState.idx];
          bodyHtml = `
            <div class="guided-flow">
              <div class="guided-question">${escapeHtml(q)}</div>
              <textarea class="stage-editor" placeholder="Your answer..."></textarea>
              <div class="stage-footer">
                <div class="footer-row">
                  <button class="action-btn weave-now-btn" style="background: #3a3a4a; margin-right: auto;">Weave Story Now</button>
                </div>
                <div class="footer-row" style="justify-content: flex-end;">
                  <button class="action-btn q-next-btn">Next</button>
                </div>
              </div>
            </div>
          `;
        } else if (guidedState.waitingForMore) {
          bodyHtml = `<div class="guided-flow"><div class="guided-loading">Checking if more info is needed...</div></div>`;
        }
      }

      el.innerHTML = `
        <div class="stage-header">
          <span class="status-dot ${s.status}"></span>
          <button class="close-tile-btn" title="Close (Esc)">✕</button>
        </div>
        <div class="stage-title">${s.title}</div>
        <div class="stage-prompt">${s.prompt}</div>
        ${bodyHtml}
      `;

      const contentEditor = el.querySelector(".content-editor");
      let flushSaveTimeout = null;
      const flushContentEditor = () => {
        if (!contentEditor) return;
        clearTimeout(flushSaveTimeout);
        saveStageContent(s.key, contentEditor.value);
      };
      if (contentEditor) {
        contentEditor.addEventListener("input", () => {
          const newContent = contentEditor.value;
          const wordsEl = el.querySelector(".stage-words");
          if (wordsEl) wordsEl.textContent = `${StoryStore.wordCount(newContent)} words`;
          const dotEl = el.querySelector(".status-dot");
          if (dotEl) dotEl.className = `status-dot ${StoryStore.stageStatus(newContent)}`;
          clearTimeout(flushSaveTimeout);
          flushSaveTimeout = setTimeout(() => saveStageContent(s.key, newContent), 500);
        });
        contentEditor.addEventListener("blur", flushContentEditor);
      }

      const closeTileBtn = el.querySelector(".close-tile-btn");
      if (closeTileBtn) {
        closeTileBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          flushContentEditor();
          collapseFocused();
        });
      }

      const redoBtn = el.querySelector(".redo-guided-btn");
      if (redoBtn) {
        redoBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          flushContentEditor();
          startGuidedFlow(s.key);
        });
      }

      const startBtn = el.querySelector(".start-guided-btn");
      if (startBtn) {
        startBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          startGuidedFlow(s.key);
        });
      }

      const retryBtn = el.querySelector(".retry-btn");
      if (retryBtn) {
        retryBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          startGuidedFlow(s.key);
        });
      }

      const nextBtn = el.querySelector(".next-btn");
      if (nextBtn) {
        nextBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          flushContentEditor();
          focusStage(stages[i + 1].key, i + 1);
        });
      }

      const weaveNowBtn = el.querySelector(".weave-now-btn");
      if (weaveNowBtn) {
        weaveNowBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          const answer = el.querySelector(".stage-editor").value.trim();
          if (answer) {
             guidedState.q_and_a.push({
               q: guidedState.questions[guidedState.idx],
               a: answer
             });
             guidedState.idx++;
          }
          await doWeave(s.key);
        });
      }

      const qNextBtn = el.querySelector(".q-next-btn");
      if (qNextBtn) {
        qNextBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          const answer = el.querySelector(".stage-editor").value.trim();
          if (!answer) return;

          guidedState.q_and_a.push({
            q: guidedState.questions[guidedState.idx],
            a: answer
          });
          guidedState.idx++;

          // trigger background fetch if we aren't already waiting
          fetchMoreQuestionsInBackground(s.key);

          if (guidedState.idx < guidedState.questions.length) {
            render();
          } else {
            // Reached the end of available questions
            if (guidedState.noMoreQuestions) {
              await doWeave(s.key);
            } else if (guidedState.fetchingBackground) {
              guidedState.waitingForMore = true;
              render();
            } else {
              // Should not happen, but fallback
              await doWeave(s.key);
            }
          }
        });
      }

      const acceptBtn = el.querySelector(".accept");
      if (acceptBtn) {
        acceptBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          const content = currentSuggestion();
          logGuidedSession(guidedState.currentStageKey, {
            started_at: guidedState.sessionStartTime,
            model: guidedState.model,
            generation_times_ms: guidedState.generationTimes,
            questions: guidedState.questions,
            q_and_a: guidedState.q_and_a,
            final_woven_content: content,
            versions: guidedState.versions,
            accepted_version_index: guidedState.versionIdx
          });
          guidedState = null;
          guidedGeneration++;
          await saveStageContent(s.key, content);
          render();
        });
      }

      const rejectBtn = el.querySelector(".reject");
      if (rejectBtn) {
        rejectBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          guidedState = null;
          guidedGeneration++;
          render();
        });
      }
    }

    el.addEventListener("click", (e) => {
      // Ignore clicks on textareas, buttons, or inside the guided flow interactive area
      if (e.target.tagName.toLowerCase() === 'textarea' || e.target.tagName.toLowerCase() === 'button' ||
          e.target.closest('.guided-flow')) {
        return;
      }

      // Don't collapse if the click is the end of a text-selection drag
      const selection = window.getSelection();
      if (selection && selection.toString().length > 0) {
        return;
      }

      if (focusedKey === null) {
        focusStage(s.key, i);
      } else if (s.key === focusedKey) {
        const editor = el.querySelector(".content-editor");
        if (editor) saveStageContent(s.key, editor.value);
        collapseFocused();
      }
    });

    grid.appendChild(el);
  });

  if (focusedKey !== null && guidedState && !guidedState.loading && guidedState.questions && !currentSuggestion()) {
    const textarea = grid.querySelector(".stage.focused .stage-editor");
    if (textarea) textarea.focus();
  }
}

function focusStage(key, idx) {
  if (focusedKey !== key) {
    focusedKey = key;
    selectedIdx = idx;
    guidedState = null;
    render();
  }
}

function getStorySoFar(key) {
  const idx = stages.findIndex((s) => s.key === key);
  return stages
    .slice(0, idx)
    .filter((s) => s.content.trim())
    .map((s) => `--- ${s.key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())} ---\n${s.content.trim()}`)
    .join("\n\n");
}

function collapseFocused() {
  focusedKey = null;
  guidedState = null;
  guidedGeneration++;
  render();
}

async function saveStageContent(key, content) {
  const stage = stages.find((s) => s.key === key);
  const result = StoryStore.saveStageContent(currentStory, key, content);
  stage.content = content;
  stage.wordCount = result.wordCount;
  stage.status = result.status;
  updateStatusBar(stages.filter((s) => s.status === "done").length);
}

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

async function startGuidedFlow(key) {
  const generation = ++guidedGeneration;
  guidedState = {
    loading: true,
    questions: [],
    q_and_a: [],
    idx: 0,
    versions: [],
    versionIdx: 0,
    error: null,
    fetchingBackground: false,
    waitingForMore: false,
    noMoreQuestions: false,
    sessionStartTime: new Date().toISOString(),
    model: 'mimo-v2.5',
    generationTimes: { questions: 0, weave: 0 },
    currentStageKey: key
  };
  const modelSelectEl = document.getElementById("model-select");
  if (modelSelectEl) {
    guidedState.model = modelSelectEl.value;
  }
  render();
  const stage = stages.find((s) => s.key === key);
  const storySoFar = getStorySoFar(key);
  try {
    const questionGenStart = performance.now();
    const questions = await AIClient.generateQuestions(stage.prompt, storySoFar, []);
    guidedState.generationTimes.questions = Math.round(performance.now() - questionGenStart);
    if (generation !== guidedGeneration) return; // tile was closed or reset while this was in flight
    if (questions.length > 0) {
      guidedState.questions = questions;
    } else {
      guidedState.error = "AI returned no initial questions.";
    }
    guidedState.loading = false;
  } catch (err) {
    if (generation !== guidedGeneration) return;
    guidedState.error = err.message || "Network error";
    guidedState.loading = false;
  }
  if (focusedKey === key) render();
}

async function fetchMoreQuestionsInBackground(key) {
  if (guidedState.noMoreQuestions || guidedState.fetchingBackground) return;
  const generation = guidedGeneration;
  guidedState.fetchingBackground = true;
  const stage = stages.find((s) => s.key === key);
  const storySoFar = getStorySoFar(key);
  try {
    const questions = await AIClient.generateQuestions(stage.prompt, storySoFar, guidedState.q_and_a);
    if (generation !== guidedGeneration) return;
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
    if (generation !== guidedGeneration) return;
    // If the user is blocked on this prefetch, don't strand them on the
    // spinner. Weave with the answers we already have — and if the failure
    // is persistent rather than transient, doWeave surfaces the real error.
    if (guidedState.waitingForMore) {
      guidedState.waitingForMore = false;
      guidedState.fetchingBackground = false;
      await doWeave(key);
    }
  } finally {
    if (generation === guidedGeneration && guidedState) guidedState.fetchingBackground = false;
  }
}

async function doWeave(key) {
  const generation = guidedGeneration;
  guidedState.loading = true;
  guidedState.waitingForMore = false;
  if (focusedKey === key) render();
  const stage = stages.find((s) => s.key === key);
  const storySoFar = getStorySoFar(key);
  try {
    const weaveStart = performance.now();
    const suggestion = await AIClient.weaveAnswers(stage.prompt, storySoFar, guidedState.q_and_a);
    guidedState.generationTimes.weave = Math.round(performance.now() - weaveStart);
    if (generation !== guidedGeneration) return;
    pushVersion(suggestion, "generated", null);
  } catch (err) {
    if (generation !== guidedGeneration) return;
    guidedState.error = err.message || "Network error";
  } finally {
    if (generation === guidedGeneration && guidedState) {
      guidedState.loading = false;
      if (focusedKey === key) render();
    }
  }
}

function updateStatusBar(count) {
  statusBar.textContent = count === 12 ? "12/12 — all complete!" : `${count}/12 stages complete`;
}

document.addEventListener("keydown", (e) => {
  if (focusedKey !== null) {
    if (e.key === "Escape") {
      e.preventDefault();
      collapseFocused();
    }
    // Command+S saving is less relevant since guided flow saves via Accept
    return;
  }

  const tag = e.target.tagName;
  if (tag === "TEXTAREA" || tag === "INPUT" || e.target.isContentEditable) {
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

async function initSettingsPanel() {
  const toggle = document.getElementById("settings-toggle");
  const panel = document.getElementById("settings-panel");
  const providerSelect = document.getElementById("provider-select");
  const apiKeyLabel = document.getElementById("api-key-label");
  const apiKeyInput = document.getElementById("api-key-input");
  const modelSelect = document.getElementById("model-select");
  const ageRangeSelect = document.getElementById("age-range-select");
  const exportBtn = document.getElementById("export-btn");
  const importInput = document.getElementById("import-input");
  const closeBtn = document.getElementById("settings-close");

  const PROVIDER_LABELS = {
    "opencode-go": "OpenCode Go API Key",
    anthropic: "Anthropic API Key",
    openai: "OpenAI API Key",
  };

  const modelsRes = await fetch("data/models.json");
  const modelsByProvider = await modelsRes.json();

  let settings = Settings.load();
  ageRangeSelect.value = currentStory.ageRange || settings.ageRange;

  function renderProvider() {
    providerSelect.value = settings.provider;
    apiKeyLabel.firstChild.textContent = PROVIDER_LABELS[settings.provider];
    apiKeyInput.value = settings.apiKeys[settings.provider] || "";

    const models = modelsByProvider[settings.provider] || [];
    modelSelect.innerHTML = models.map((m) => `<option value="${m}">${m}</option>`).join("");
    modelSelect.value = models.includes(settings.model) ? settings.model : models[0];
    if (modelSelect.value) settings = Settings.save({ model: modelSelect.value });
  }

  renderProvider();

  toggle.addEventListener("click", () => panel.classList.toggle("hidden"));
  closeBtn.addEventListener("click", () => panel.classList.add("hidden"));

  providerSelect.addEventListener("change", () => {
    settings = Settings.save({ provider: providerSelect.value });
    renderProvider();
  });

  apiKeyInput.addEventListener("change", () => {
    settings = Settings.save({
      apiKeys: { ...settings.apiKeys, [settings.provider]: apiKeyInput.value },
    });
  });

  modelSelect.addEventListener("change", () => {
    settings = Settings.save({ model: modelSelect.value });
  });

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

init();
