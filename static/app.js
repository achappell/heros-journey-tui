let stages = [];
let story = {};
let selectedIdx = 0;
let expandedKey = null;

const grid = document.getElementById("grid");
const overlay = document.getElementById("editor-overlay");
const textarea = document.getElementById("editor-textarea");

async function init() {
  const [stagesRes, storyRes] = await Promise.all([
    fetch("/api/stages"),
    fetch("/api/story"),
  ]);
  stages = await stagesRes.json();
  story = await storyRes.json();
  renderGrid();
  updateStatus();
  selectStage(0);
}

function renderGrid() {
  grid.innerHTML = "";
  stages.forEach((s, i) => {
    const stageData = story.stages?.[s.key] || { wordCount: 0, status: "empty" };
    const num = s.title.split(".")[0];
    const title = s.title.split(". ").slice(1).join(". ");
    const el = document.createElement("div");
    el.className = "stage" + (i === selectedIdx ? " selected" : "");
    el.dataset.index = i;
    el.innerHTML = `
      <div class="stage-header">
        <div class="stage-num">${num}</div>
        <div class="stage-status ${stageData.status}"></div>
      </div>
      <div class="stage-title">${title}</div>
      <div class="stage-prompt">${s.prompt}</div>
      <div class="stage-footer">
        <span class="stage-words">${stageData.wordCount || 0} words</span>
        <span class="stage-action">Edit →</span>
      </div>
    `;
    el.addEventListener("click", () => {
      selectStage(i);
      openEditor(s.key);
    });
    grid.appendChild(el);
  });
}

function selectStage(idx) {
  selectedIdx = idx;
  grid.querySelectorAll(".stage").forEach((el, i) => {
    el.classList.toggle("selected", i === idx);
  });
}

function updateStatus() {
  const count = story.completedCount || 0;
  document.getElementById("status-count").textContent = `${count}/12`;
  document.getElementById("status-text").textContent =
    count === 12 ? "all complete!" : "stages complete";
}

function openEditor(key) {
  expandedKey = key;
  const template = stages.find((s) => s.key === key);
  const data = story.stages?.[key] || { content: "", wordCount: 0, status: "empty" };
  const num = template.title.split(".")[0];
  const title = template.title.split(". ").slice(1).join(". ");

  document.getElementById("editor-stage-num").textContent = num;
  document.getElementById("editor-title").textContent = title;
  document.getElementById("editor-prompt").textContent = template.prompt;
  textarea.value = data.content || "";
  updateEditorMeta(data.status);

  overlay.classList.add("open");
  setTimeout(() => textarea.focus(), 100);
}

function closeEditor() {
  overlay.classList.remove("open");
  expandedKey = null;
}

function updateEditorMeta(status) {
  const words = textarea.value.trim() ? textarea.value.trim().split(/\s+/).length : 0;
  document.getElementById("editor-wordcount").textContent = `${words} word${words !== 1 ? "s" : ""}`;

  const statusEl = document.getElementById("editor-status");
  if (status === "done") {
    statusEl.textContent = "Complete";
    statusEl.style.color = "#10b981";
  } else if (status === "started") {
    statusEl.textContent = "In progress";
    statusEl.style.color = "#f59e0b";
  } else {
    statusEl.textContent = "Not started";
    statusEl.style.color = "";
  }
}

function getStatusFromWords(words) {
  if (words === 0) return "empty";
  if (words < 50) return "started";
  return "done";
}

async function saveCurrentStage() {
  if (!expandedKey) return;
  const content = textarea.value;
  const btn = document.getElementById("btn-save");

  const res = await fetch(`/api/story/stage/${expandedKey}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  const result = await res.json();

  if (result.ok) {
    story.stages[expandedKey] = {
      ...story.stages[expandedKey],
      content,
      wordCount: result.wordCount,
      status: result.status,
    };
    story.lastSaved = result.lastSaved;
    story.completedCount = Object.values(story.stages).filter(s => s?.status === "done").length;

    btn.classList.add("saved");
    btn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
      Saved
    `;

    setTimeout(() => {
      btn.classList.remove("saved");
      btn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
        Save
      `;
    }, 1500);

    renderGrid();
    updateStatus();
    updateEditorMeta(result.status);
  }
}

// Event listeners
textarea.addEventListener("input", () => {
  const words = textarea.value.trim() ? textarea.value.trim().split(/\s+/).length : 0;
  updateEditorMeta(getStatusFromWords(words));
});

document.getElementById("btn-close").addEventListener("click", closeEditor);
document.getElementById("btn-save").addEventListener("click", saveCurrentStage);

overlay.addEventListener("click", (e) => {
  if (e.target === overlay) closeEditor();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeEditor();
  if (e.key === "s" && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    saveCurrentStage();
  }
});

// Keyboard navigation on grid
document.addEventListener("keydown", (e) => {
  if (overlay.classList.contains("open")) return;

  if (e.key === "ArrowRight" || e.key === "l") {
    e.preventDefault();
    selectStage(Math.min(selectedIdx + 1, stages.length - 1));
  }
  if (e.key === "ArrowLeft" || e.key === "h") {
    e.preventDefault();
    selectStage(Math.max(selectedIdx - 1, 0));
  }
  if (e.key === "ArrowDown" || e.key === "j") {
    e.preventDefault();
    selectStage(Math.min(selectedIdx + 4, stages.length - 1));
  }
  if (e.key === "ArrowUp" || e.key === "k") {
    e.preventDefault();
    selectStage(Math.max(selectedIdx - 4, 0));
  }
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    openEditor(stages[selectedIdx].key);
  }
});

init();
