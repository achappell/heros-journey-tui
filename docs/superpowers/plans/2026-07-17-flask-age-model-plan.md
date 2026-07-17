# Flask: Age-Range Tailoring + Model Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add age-range-tailored AI prompting and model selection to the local Flask app, and publish the shared model/age-guidance/stage data as static JSON files that both the Flask app and the (separately planned) static site read.

**Architecture:** Two new static JSON data files (`static/data/models.json`, `static/data/age_guidance.json`) become the single source of truth for the model list and age-tailoring text. `models.py` gains an `age_range` field on `StoryProject`. `ai.py`'s three functions gain `model` and `age_range` parameters and prepend age guidance to their system prompts. `app.py` wires `age_range` through `/api/story`, passes `model` through `/api/ai/*`, and exposes a new `GET /api/models` route.

**Tech Stack:** Python 3, Flask, pytest, unittest.mock.

## Global Constraints

- `age_range` values are exactly: `"kids"`, `"tween"`, `"teen"`, `"adult"`. Default is `"adult"`.
- Default model is `"mimo-v2.5"` (matches current hardcoded behavior).
- Model list is the confirmed `zen/go` list: `mimo-v2.5, mimo-v2.5-pro, mimo-v2-pro, mimo-v2-omni, minimax-m3, minimax-m2.7, minimax-m2.5, kimi-k3, kimi-k2.7-code, kimi-k2.6, kimi-k2.5, glm-5.2, glm-5.1, glm-5, deepseek-v4-pro, deepseek-v4-flash, qwen3.7-max, qwen3.7-plus, qwen3.6-plus, qwen3.5-plus, hy3-preview, grok-4.5`.
- Data files live under `static/data/` (not `prompts/`) so the same files can later be published as part of the static GitHub Pages site without duplication.

---

### Task 1: Shared data files (models + age guidance)

**Files:**
- Create: `static/data/models.json`
- Create: `static/data/age_guidance.json`
- Test: `tests/test_data_files.py`

**Interfaces:**
- Produces: `static/data/models.json` — a JSON array of model id strings, first entry `"mimo-v2.5"`.
- Produces: `static/data/age_guidance.json` — a JSON object with exactly the keys `kids`, `tween`, `teen`, `adult`, each mapping to a string (empty string for `adult`).

- [ ] **Step 1: Write the failing test**

```python
# tests/test_data_files.py
import json
from pathlib import Path

DATA_DIR = Path(__file__).parent.parent / "static" / "data"


def test_models_json_is_valid():
    models = json.loads((DATA_DIR / "models.json").read_text())
    assert isinstance(models, list)
    assert models[0] == "mimo-v2.5"
    assert "grok-4.5" in models
    assert len(models) == 21


def test_age_guidance_json_has_all_buckets():
    guidance = json.loads((DATA_DIR / "age_guidance.json").read_text())
    assert set(guidance.keys()) == {"kids", "tween", "teen", "adult"}
    assert guidance["adult"] == ""
    assert "simple" in guidance["kids"].lower()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_data_files.py -v`
Expected: FAIL with `FileNotFoundError` (files don't exist yet)

- [ ] **Step 3: Create the data files**

```json
// static/data/models.json
[
  "mimo-v2.5",
  "mimo-v2.5-pro",
  "mimo-v2-pro",
  "mimo-v2-omni",
  "minimax-m3",
  "minimax-m2.7",
  "minimax-m2.5",
  "kimi-k3",
  "kimi-k2.7-code",
  "kimi-k2.6",
  "kimi-k2.5",
  "glm-5.2",
  "glm-5.1",
  "glm-5",
  "deepseek-v4-pro",
  "deepseek-v4-flash",
  "qwen3.7-max",
  "qwen3.7-plus",
  "qwen3.6-plus",
  "qwen3.5-plus",
  "hy3-preview",
  "grok-4.5"
]
```

```json
// static/data/age_guidance.json
{
  "kids": "Write for children ages 6-9: use simple, everyday vocabulary and short sentences. Avoid violence, death, or scary content — conflicts should resolve kindly and gently.",
  "tween": "Write for readers ages 10-12: use clear vocabulary and moderate sentence complexity. Mild peril or tension is fine, but avoid anything graphic or disturbing.",
  "teen": "Write for teen readers ages 13-17: use a natural, engaging YA-novel register. Real stakes and conflict are welcome, but avoid graphic violence or explicit content.",
  "adult": ""
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_data_files.py -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add static/data/models.json static/data/age_guidance.json tests/test_data_files.py
git commit -m "Add shared model list and age-guidance data files"
```

---

### Task 2: `StoryProject.age_range`

**Files:**
- Modify: `models.py:69-107` (the `StoryProject` dataclass, `to_dict`, `save`, `load`)
- Test: `tests/test_models.py`

**Interfaces:**
- Consumes: nothing new.
- Produces: `StoryProject.age_range: str` (default `"adult"`), included in `to_dict()` under key `"age_range"` and round-tripped by `save`/`load`.

- [ ] **Step 1: Write the failing test**

```python
# append to tests/test_models.py
def test_story_project_default_age_range():
    project = StoryProject()
    assert project.age_range == "adult"


def test_story_project_age_range_save_load(tmp_path):
    project = StoryProject()
    project.age_range = "kids"

    save_file = tmp_path / "story.json"
    project.save(save_file)

    loaded_project = StoryProject.load(save_file)
    assert loaded_project.age_range == "kids"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_models.py -v`
Expected: FAIL with `AttributeError: 'StoryProject' object has no attribute 'age_range'`

- [ ] **Step 3: Add the field**

In `models.py`, modify the `StoryProject` dataclass:

```python
@dataclass
class StoryProject:
    title: str = "Untitled Story"
    age_range: str = "adult"
    stages: dict[str, Stage] = field(default_factory=dict)
    path: Path | None = None
    last_saved: str | None = None
```

Modify `to_dict`:

```python
    def to_dict(self) -> dict:
        return {
            "title": self.title,
            "age_range": self.age_range,
            "stages": {k: s.to_dict() for k, s in self.stages.items()},
        }
```

Modify `load`:

```python
    @classmethod
    def load(cls, path: Path) -> StoryProject:
        data = json.loads(path.read_text(encoding="utf-8"))
        project = cls(
            title=data.get("title", "Untitled Story"),
            age_range=data.get("age_range", "adult"),
        )
        for key, raw in data.get("stages", {}).items():
            if key in project.stages:
                project.stages[key] = Stage.from_dict(raw)
        project.path = path
        return project
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_models.py -v`
Expected: PASS (all tests in file pass)

- [ ] **Step 5: Commit**

```bash
git add models.py tests/test_models.py
git commit -m "Add age_range field to StoryProject"
```

---

### Task 3: `ai.py` — model + age-range parameters

**Files:**
- Modify: `ai.py` (all three public functions: `call_zen`, `generate_questions`, `weave_answers`)
- Test: `tests/test_ai.py`

**Interfaces:**
- Consumes: `static/data/age_guidance.json` (from Task 1).
- Produces: `call_zen(action, content, stage_prompt, api_key, model="mimo-v2.5", age_range="adult")`, `generate_questions(stage_prompt, story_so_far, q_and_a, api_key, model="mimo-v2.5", age_range="adult")`, `weave_answers(stage_prompt, story_so_far, q_and_a, api_key, model="mimo-v2.5", age_range="adult")` — all now use `model` in the request payload and prepend age guidance (when non-empty) to the system message.

- [ ] **Step 1: Write the failing tests**

```python
# append to tests/test_ai.py
from ai import call_zen, weave_answers


@patch("ai.requests.post")
def test_generate_questions_passes_model(mock_post):
    mock_post.return_value.status_code = 200
    mock_post.return_value.json.return_value = {
        "choices": [{"message": {"content": "[]"}}]
    }

    generate_questions("prompt", "story so far", [], "fake_key", model="grok-4.5")

    payload = mock_post.call_args[1]["json"]
    assert payload["model"] == "grok-4.5"


@patch("ai.requests.post")
def test_generate_questions_applies_kids_age_guidance(mock_post):
    mock_post.return_value.status_code = 200
    mock_post.return_value.json.return_value = {
        "choices": [{"message": {"content": "[]"}}]
    }

    generate_questions("prompt", "story so far", [], "fake_key", age_range="kids")

    payload = mock_post.call_args[1]["json"]
    system_msg = payload["messages"][0]["content"]
    assert "ages 6-9" in system_msg


@patch("ai.requests.post")
def test_generate_questions_adult_has_no_guidance_text(mock_post):
    mock_post.return_value.status_code = 200
    mock_post.return_value.json.return_value = {
        "choices": [{"message": {"content": "[]"}}]
    }

    generate_questions("prompt", "story so far", [], "fake_key", age_range="adult")

    payload = mock_post.call_args[1]["json"]
    system_msg = payload["messages"][0]["content"]
    assert "ages 6-9" not in system_msg
    assert "ages 10-12" not in system_msg


@patch("ai.requests.post")
def test_call_zen_passes_model_and_age_guidance(mock_post):
    mock_post.return_value.status_code = 200
    mock_post.return_value.json.return_value = {
        "choices": [{"message": {"content": "refined text"}}]
    }

    call_zen("refine", "some text", "stage prompt", "fake_key", model="glm-5.2", age_range="teen")

    payload = mock_post.call_args[1]["json"]
    assert payload["model"] == "glm-5.2"
    assert "YA-novel" in payload["messages"][0]["content"]


@patch("ai.requests.post")
def test_weave_answers_passes_model_and_age_guidance(mock_post):
    mock_post.return_value.status_code = 200
    mock_post.return_value.json.return_value = {
        "choices": [{"message": {"content": "woven text"}}]
    }

    weave_answers("stage prompt", "story so far", [{"q": "Q?", "a": "A."}], "fake_key",
                   model="kimi-k3", age_range="tween")

    payload = mock_post.call_args[1]["json"]
    assert payload["model"] == "kimi-k3"
    assert "ages 10-12" in payload["messages"][0]["content"]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_ai.py -v`
Expected: FAIL with `TypeError: generate_questions() got an unexpected keyword argument 'model'` (and similar for the others)

- [ ] **Step 3: Implement**

Add a helper near the top of `ai.py`, after the existing imports:

```python
DATA_DIR = Path(__file__).parent / "static" / "data"


def _age_guidance(age_range: str) -> str:
    guidance = json.loads((DATA_DIR / "age_guidance.json").read_text(encoding="utf-8"))
    return guidance.get(age_range, "")
```

Modify `call_zen`'s signature and body:

```python
def call_zen(action: str, content: str, stage_prompt: str, api_key: str,
             model: str = "mimo-v2.5", age_range: str = "adult") -> str:
    url = "https://opencode.ai/zen/go/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }

    try:
        prompt_path = Path(__file__).parent / "prompts" / f"{action}.md"
        system_msg = prompt_path.read_text(encoding="utf-8").strip()
    except FileNotFoundError:
        raise RuntimeError(f"Unknown action: {action}")

    guidance = _age_guidance(age_range)
    if guidance:
        system_msg = f"{guidance}\n\n{system_msg}"
    system_msg += f"\n\nStage context: {stage_prompt}"

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_msg},
            {"role": "user", "content": content}
        ]
    }
```

(the rest of `call_zen` is unchanged)

Modify `generate_questions`'s signature and system message construction:

```python
def generate_questions(stage_prompt: str, story_so_far: str, q_and_a: list, api_key: str,
                        model: str = "mimo-v2.5", age_range: str = "adult") -> list[str]:
    url = "https://opencode.ai/zen/go/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }

    system_msg = (
        "You are an expert storytelling guide. Your task is to guide the user in writing the next stage of their story. "
        "Ask questions that are easy to answer, quick, and cut to the point. "
        "Use a casual, conversational, and friendly tone in your questions. Avoid sounding overly formal or academic. "
        "Based on the stage context, the story so far, and the questions the user has already answered, decide if more information is needed to write a complete entry. "
        "If you have a full picture and no more questions are needed, output an empty JSON array []. "
        "If more questions are needed, generate 1 to 2 new thought-provoking questions. "
        "Output ONLY a valid JSON array of strings, e.g., [\"Question 1?\"], with no markdown formatting."
    )
    guidance = _age_guidance(age_range)
    if guidance:
        system_msg = f"{guidance}\n\n{system_msg}"

    qa_text = ""
    if q_and_a:
        qa_text = "\n\nUser's answers so far:\n" + "\n".join([f"Q: {item['q']}\nA: {item['a']}" for item in q_and_a])

    user_msg = f"Story so far:\n{story_so_far if story_so_far else '(Beginning of the story)'}\n\nStage context: {stage_prompt}{qa_text}"

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_msg},
            {"role": "user", "content": user_msg}
        ]
    }
```

(the rest of `generate_questions` is unchanged)

Modify `weave_answers`'s signature and system message construction:

```python
def weave_answers(stage_prompt: str, story_so_far: str, q_and_a: list, api_key: str,
                   model: str = "mimo-v2.5", age_range: str = "adult") -> str:
    url = "https://opencode.ai/zen/go/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }

    system_msg = (
        "You are an expert storyteller. The user has answered a series of guiding questions for a specific stage of the Hero's Journey. "
        "Your task is to weave their answers into a cohesive, well-written narrative passage for this stage. "
        "Use their ideas directly, adopting a descriptive and engaging tone that matches the story so far. "
        "Output only the narrative text, no extra commentary."
    )
    guidance = _age_guidance(age_range)
    if guidance:
        system_msg = f"{guidance}\n\n{system_msg}"

    qa_text = "\n".join([f"Q: {item['q']}\nA: {item['a']}" for item in q_and_a])
    user_msg = f"Story so far:\n{story_so_far if story_so_far else '(Beginning of the story)'}\n\nStage context: {stage_prompt}\n\nUser's Q&A:\n{qa_text}"

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_msg},
            {"role": "user", "content": user_msg}
        ]
    }
```

(the rest of `weave_answers` is unchanged)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_ai.py -v`
Expected: PASS (all tests pass)

- [ ] **Step 5: Commit**

```bash
git add ai.py tests/test_ai.py
git commit -m "Add model selection and age-range guidance to AI calls"
```

---

### Task 4: `app.py` — wire age_range and model through the API

**Files:**
- Modify: `app.py:41-163`
- Test: `tests/test_app.py`

**Interfaces:**
- Consumes: `call_zen(..., model, age_range)`, `generate_questions(..., model, age_range)`, `weave_answers(..., model, age_range)` from Task 3; `StoryProject.age_range` from Task 2; `static/data/models.json` from Task 1.
- Produces: `GET /api/models` (returns the model list); `GET /api/story` response includes `"ageRange"`; `PUT /api/story` accepts `"ageRange"`; `POST /api/ai/<action>`, `POST /api/ai/questions/<key>`, `POST /api/ai/weave/<key>` accept an optional `"model"` field in the JSON body (default `"mimo-v2.5"`) and use the story's stored `age_range`.

- [ ] **Step 1: Write the failing tests**

```python
# append to tests/test_app.py
def test_get_models(client):
    response = client.get("/api/models")
    assert response.status_code == 200
    data = response.get_json()
    assert "mimo-v2.5" in data
    assert isinstance(data, list)


def test_get_story_includes_age_range(client):
    response = client.get("/api/story")
    assert response.status_code == 200
    data = response.get_json()
    assert "ageRange" in data


def test_put_story_persists_age_range(client):
    response = client.put("/api/story", json={"ageRange": "teen"})
    assert response.status_code == 200

    response = client.get("/api/story")
    data = response.get_json()
    assert data["ageRange"] == "teen"

    # reset for other tests
    client.put("/api/story", json={"ageRange": "adult"})


@patch("app.ai.call_zen")
def test_api_ai_passes_model_and_age_range(mock_call_zen, client):
    mock_call_zen.return_value = "suggestion text"
    client.put("/api/story", json={"ageRange": "kids"})

    response = client.post("/api/ai/refine", json={
        "content": "some text",
        "stage_prompt": "prompt",
        "model": "grok-4.5",
    })

    assert response.status_code == 200
    mock_call_zen.assert_called_once()
    _, kwargs = mock_call_zen.call_args
    args = mock_call_zen.call_args[0]
    assert "grok-4.5" in args or kwargs.get("model") == "grok-4.5"
    assert "kids" in args or kwargs.get("age_range") == "kids"

    client.put("/api/story", json={"ageRange": "adult"})
```

Add `from unittest.mock import patch` to the top of `tests/test_app.py` if not already present.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_app.py -v`
Expected: FAIL — `/api/models` 404s, `"ageRange"` missing from responses, `test_api_ai_passes_model_and_age_range` fails because `OPENCODE_ZEN_API_KEY` isn't set in the test env (503) or the call doesn't include the new args.

Note: if `test_api_ai_passes_model_and_age_range` fails with a 503 because `OPENCODE_ZEN_API_KEY` is unset in the test environment, add this to the top of the test:

```python
    app.config["TESTING"] = True
```

and ensure `OPENCODE_ZEN_API_KEY` is set for the test session by adding a `conftest.py`:

```python
# tests/conftest.py
import os
os.environ.setdefault("OPENCODE_ZEN_API_KEY", "test-key")
```

This must be created before `app` is imported by any test module, which `conftest.py` guarantees (pytest loads it first).

- [ ] **Step 3: Implement**

Add near the top of `app.py`, after `SAVE_DIR`/`DEFAULT_SAVE`:

```python
DATA_DIR = Path(__file__).parent / "static" / "data"
```

Add a new route (place it near `api_stages`):

```python
@app.route("/api/models")
def api_models():
    import json
    models = json.loads((DATA_DIR / "models.json").read_text(encoding="utf-8"))
    return jsonify(models)
```

Modify `api_get_story` to include `ageRange`:

```python
@app.route("/api/story", methods=["GET"])
def api_get_story():
    project = get_project()
    return jsonify({
        "title": project.title,
        "ageRange": project.age_range,
        "stages": {
            k: {"key": s.key, "content": s.content, "wordCount": s.word_count, "status": s.status}
            for k, s in project.stages.items()
        },
        "completedCount": project.completed_count,
        "lastSaved": project.last_saved,
    })
```

Modify `api_save_story` to accept `ageRange`:

```python
@app.route("/api/story", methods=["PUT"])
def api_save_story():
    data = request.get_json(silent=True) or {}
    project = get_project()

    if "title" in data:
        project.title = data["title"]

    if "ageRange" in data:
        project.age_range = data["ageRange"]

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
```

Modify `api_ai` to pass `model` and the story's `age_range`:

```python
@app.route("/api/ai/<action>", methods=["POST"])
def api_ai(action: str):
    if not OPENCODE_ZEN_API_KEY:
        return jsonify({"error": "AI features are not configured (missing OPENCODE_ZEN_API_KEY)"}), 503

    if action not in ["refine", "expand", "shorten"]:
        return jsonify({"error": "Unknown action"}), 400

    data = request.get_json(silent=True) or {}
    if not data or "content" not in data or "stage_prompt" not in data:
        return jsonify({"error": "Missing content or stage_prompt"}), 400

    model = data.get("model", "mimo-v2.5")
    age_range = get_project().age_range

    try:
        suggestion = ai.call_zen(action, data["content"], data["stage_prompt"], OPENCODE_ZEN_API_KEY,
                                  model=model, age_range=age_range)
        return jsonify({"suggestion": suggestion})
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 502
```

Modify `api_ai_questions` similarly:

```python
@app.route("/api/ai/questions/<key>", methods=["POST"])
def api_ai_questions(key: str):
    if not OPENCODE_ZEN_API_KEY:
        return jsonify({"error": "AI features are not configured"}), 503

    project = get_project()
    if key not in project.stages:
        return jsonify({"error": "unknown stage key"}), 404

    data = request.get_json(silent=True) or {}
    q_and_a = data.get("q_and_a", [])
    model = data.get("model", "mimo-v2.5")

    stage_prompt = next((s["prompt"] for s in stages_as_list() if s["key"] == key), "")
    story_so_far = _get_story_so_far(project, key)

    try:
        questions = ai.generate_questions(stage_prompt, story_so_far, q_and_a, OPENCODE_ZEN_API_KEY,
                                           model=model, age_range=project.age_range)
        return jsonify({"questions": questions})
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 502
```

Modify `api_ai_weave` similarly:

```python
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

    model = data.get("model", "mimo-v2.5")
    stage_prompt = next((s["prompt"] for s in stages_as_list() if s["key"] == key), "")
    story_so_far = _get_story_so_far(project, key)

    try:
        suggestion = ai.weave_answers(stage_prompt, story_so_far, data["q_and_a"], OPENCODE_ZEN_API_KEY,
                                       model=model, age_range=project.age_range)
        return jsonify({"suggestion": suggestion})
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 502
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest -v`
Expected: all tests pass (existing + new)

- [ ] **Step 5: Commit**

```bash
git add app.py tests/test_app.py tests/conftest.py
git commit -m "Wire age_range and model selection through the Flask API"
```

---

## Self-Review Notes

- **Spec coverage:** age-range buckets (Task 1), per-story `age_range` field (Task 2), age-tailored prompts (Task 3), model passthrough (Task 3+4), `/api/models` route (Task 4) — all covered. Static-site consumption of these same files is out of scope for this plan (see the separate static-site plan).
- **No placeholders:** all steps contain complete, runnable code.
- **Type consistency:** `age_range` (snake_case) used consistently in Python; `ageRange` (camelCase) used consistently at the JSON API boundary, matching the existing `wordCount`/`lastSaved` convention already in `app.py`.
