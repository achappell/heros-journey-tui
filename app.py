from __future__ import annotations

from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, jsonify, request, send_from_directory

from models import StoryProject, stages_as_list
import ai
import os

load_dotenv()
OPENCODE_ZEN_API_KEY = os.environ.get("OPENCODE_ZEN_API_KEY")

app = Flask(__name__, static_folder="static", static_url_path="")

SAVE_DIR = Path.home() / "Documents" / "HeroJourneyStories"
DEFAULT_SAVE = SAVE_DIR / "story.json"


def get_project() -> StoryProject:
    if DEFAULT_SAVE.exists():
        return StoryProject.load(DEFAULT_SAVE)
    return StoryProject()

def _get_story_so_far(project: StoryProject, current_key: str) -> str:
    content_parts = []
    for k, stage in project.stages.items():
        if k == current_key:
            break
        if stage.content.strip():
            content_parts.append(f"--- {stage.key.replace('_', ' ').title()} ---\n{stage.content.strip()}")
    return "\n\n".join(content_parts)


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
    data = request.get_json(silent=True) or {}
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
    data = request.get_json(silent=True) or {}
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


@app.route("/api/ai/<action>", methods=["POST"])
def api_ai(action: str):
    if not OPENCODE_ZEN_API_KEY:
        return jsonify({"error": "AI features are not configured (missing OPENCODE_ZEN_API_KEY)"}), 503

    if action not in ["refine", "expand", "shorten"]:
        return jsonify({"error": "Unknown action"}), 400

    data = request.get_json(silent=True) or {}
    if not data or "content" not in data or "stage_prompt" not in data:
        return jsonify({"error": "Missing content or stage_prompt"}), 400

    try:
        suggestion = ai.call_zen(action, data["content"], data["stage_prompt"], OPENCODE_ZEN_API_KEY)
        return jsonify({"suggestion": suggestion})
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 502

@app.route("/api/ai/questions/<key>", methods=["POST"])
def api_ai_questions(key: str):
    if not OPENCODE_ZEN_API_KEY:
        return jsonify({"error": "AI features are not configured"}), 503

    project = get_project()
    if key not in project.stages:
        return jsonify({"error": "unknown stage key"}), 404

    data = request.get_json(silent=True) or {}
    q_and_a = data.get("q_and_a", [])

    stage_prompt = next((s["prompt"] for s in stages_as_list() if s["key"] == key), "")
    story_so_far = _get_story_so_far(project, key)

    try:
        questions = ai.generate_questions(stage_prompt, story_so_far, q_and_a, OPENCODE_ZEN_API_KEY)
        return jsonify({"questions": questions})
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 502

@app.route("/api/ai/weave/<key>", methods=["POST"])
def api_ai_weave(key: str):
    if not OPENCODE_ZEN_API_KEY:
        return jsonify({"error": "AI features are not configured"}), 503

    project = get_project()
    if key not in project.stages:
        return jsonify({"error": "unknown stage key"}), 404

    data = request.get_json(silent=True) or {}
    if not data or "q_and_a" not in data:
        return jsonify({"error": "Missing q_and_a"}), 400

    stage_prompt = next((s["prompt"] for s in stages_as_list() if s["key"] == key), "")
    story_so_far = _get_story_so_far(project, key)

    try:
        suggestion = ai.weave_answers(stage_prompt, story_so_far, data["q_and_a"], OPENCODE_ZEN_API_KEY)
        return jsonify({"suggestion": suggestion})
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 502


if __name__ == "__main__":
    app.run(debug=True, port=5001)
