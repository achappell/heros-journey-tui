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
