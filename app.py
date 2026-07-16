from __future__ import annotations

from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory

from models import STAGES, Stage, StoryProject, stages_as_list

app = Flask(__name__, static_folder="static")

SAVE_DIR = Path.home() / "Documents" / "HeroJourneyStories"
DEFAULT_SAVE = SAVE_DIR / "story.json"


def get_project() -> StoryProject:
    if DEFAULT_SAVE.exists():
        return StoryProject.load(DEFAULT_SAVE)
    return StoryProject()


@app.route("/")
def index():
    return send_from_directory("static", "index.html")


@app.route("/api/stages")
def api_stages():
    return jsonify(stages_as_list())


@app.route("/api/story", methods=["GET"])
def api_get_story():
    project = get_project()
    return jsonify({
        "title": project.title,
        "stages": {
            k: {"key": s.key, "content": s.content, "wordCount": s.word_count, "status": s.status}
            for k, s in project.stages.items()
        },
        "completedCount": project.completed_count,
        "lastSaved": project.last_saved,
    })


@app.route("/api/story", methods=["PUT"])
def api_save_story():
    data = request.get_json()
    project = get_project()

    if "title" in data:
        project.title = data["title"]

    if "stages" in data:
        for key, stage_data in data["stages"].items():
            if key in project.stages:
                project.stages[key].content = stage_data.get("content", "")

    project.save(DEFAULT_SAVE)

    return jsonify({
        "ok": True,
        "lastSaved": project.last_saved,
        "completedCount": project.completed_count,
    })


@app.route("/api/story/stage/<key>", methods=["PUT"])
def api_save_stage(key: str):
    data = request.get_json()
    project = get_project()

    if key not in project.stages:
        return jsonify({"error": "unknown stage key"}), 404

    project.stages[key].content = data.get("content", "")
    project.save(DEFAULT_SAVE)

    stage = project.stages[key]
    return jsonify({
        "ok": True,
        "key": key,
        "wordCount": stage.word_count,
        "status": stage.status,
        "lastSaved": project.last_saved,
    })


if __name__ == "__main__":
    app.run(debug=True, port=5001)
