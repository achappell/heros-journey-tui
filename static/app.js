let stages = [];
let focusedKey = null;
let selectedIdx = 0;
let guidedState = null;

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
      let bodyHtml = '';
      if (s.content && !guidedState) {
        bodyHtml = `
          <div class="stage-content-view">${escapeHtml(s.content)}</div>
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
        } else if (guidedState.suggestion) {
          bodyHtml = `
            <div class="guided-flow">
              <div class="preview-block">
                <div class="preview-text">${escapeHtml(guidedState.suggestion)}</div>
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
          <div class="stage-num">${s.num}</div>
          <span class="status-dot ${s.status}"></span>
        </div>
        <div class="stage-title">${s.title}</div>
        <div class="stage-prompt">${s.prompt}</div>
        ${bodyHtml}
      `;

      const redoBtn = el.querySelector(".redo-guided-btn");
      if (redoBtn) {
        redoBtn.addEventListener("click", (e) => {
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
          const content = guidedState.suggestion;
          guidedState = null;
          await saveStageContent(s.key, content);
          render();
        });
      }

      const rejectBtn = el.querySelector(".reject");
      if (rejectBtn) {
        rejectBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          guidedState = null;
          render();
        });
      }
    }

    el.addEventListener("click", (e) => {
      // Ignore clicks on textareas, buttons, or inside the guided flow interactive area
      if (e.target.tagName.toLowerCase() === 'textarea' || e.target.tagName.toLowerCase() === 'button' || e.target.closest('.guided-flow')) {
        return;
      }
      
      if (focusedKey === null) {
        focusStage(s.key, i);
      } else if (s.key === focusedKey) {
        collapseFocused();
      }
    });

    grid.appendChild(el);
  });

  if (focusedKey !== null && guidedState && !guidedState.loading && guidedState.questions && !guidedState.suggestion) {
    const textarea = grid.querySelector(".stage.focused .stage-editor");
    if (textarea) textarea.focus();
  }
}

function focusStage(key, idx) {
  if (focusedKey !== key) {
    focusedKey = key;
    selectedIdx = idx;
    const s = stages[idx];
    if (!s.content) {
      startGuidedFlow(key);
    } else {
      guidedState = null;
      render();
    }
  }
}

function collapseFocused() {
  focusedKey = null;
  guidedState = null;
  render();
}

async function saveStageContent(key, content) {
  const stage = stages.find((s) => s.key === key);
  const res = await fetch(`/api/story/stage/${key}`, {
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
}

async function startGuidedFlow(key) {
  guidedState = { loading: true, questions: [], q_and_a: [], idx: 0, suggestion: null, error: null, fetchingBackground: false, waitingForMore: false, noMoreQuestions: false };
  render();
  try {
    const res = await fetch(`/api/ai/questions/${key}`, { method: "POST" });
    const data = await res.json();
    if (res.ok) {
      if (data.questions && data.questions.length > 0) {
        guidedState.questions = data.questions;
      } else {
        guidedState.error = "AI returned no initial questions.";
      }
      guidedState.loading = false;
    } else {
      guidedState.error = data.error;
      guidedState.loading = false;
    }
  } catch (err) {
    guidedState.error = "Network error";
    guidedState.loading = false;
  }
  if (focusedKey === key) render();
}

async function fetchMoreQuestionsInBackground(key) {
  if (guidedState.noMoreQuestions || guidedState.fetchingBackground) return;
  guidedState.fetchingBackground = true;
  try {
    const res = await fetch(`/api/ai/questions/${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q_and_a: guidedState.q_and_a })
    });
    const data = await res.json();
    if (res.ok && data.questions) {
      if (data.questions.length > 0) {
        guidedState.questions.push(...data.questions);
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
    }
  } catch (err) {
    console.error("Background fetch failed", err);
  } finally {
    if (guidedState) guidedState.fetchingBackground = false;
  }
}

async function doWeave(key) {
  guidedState.loading = true;
  guidedState.waitingForMore = false;
  if (focusedKey === key) render();
  try {
    const res = await fetch(`/api/ai/weave/${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q_and_a: guidedState.q_and_a })
    });
    const data = await res.json();
    if (res.ok) {
      guidedState.suggestion = data.suggestion;
    } else {
      guidedState.error = data.error;
    }
  } catch (err) {
    guidedState.error = "Network error";
  } finally {
    guidedState.loading = false;
    if (focusedKey === key) render();
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
