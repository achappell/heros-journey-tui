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
