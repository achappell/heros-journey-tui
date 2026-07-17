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
