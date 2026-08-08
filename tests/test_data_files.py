import json
from pathlib import Path

DATA_DIR = Path(__file__).parent.parent / "static" / "data"


def test_models_json_is_valid():
    models = json.loads((DATA_DIR / "models.json").read_text())
    assert isinstance(models, dict)
    opencode_go_models = models["opencode-go"]
    assert isinstance(opencode_go_models, list)
    assert opencode_go_models[0] == "mimo-v2.5"
    assert len(opencode_go_models) == 21
    assert len(set(opencode_go_models)) == len(opencode_go_models)

    # Removed after probing the relay: these four returned "Unsupported model",
    # "Model is unavailable", or a 503 on every request. hy3-preview was
    # replaced by the generally-available hy3.
    for dead in ("mimo-v2-pro", "mimo-v2-omni", "hy3-preview", "grok-4.5"):
        assert dead not in opencode_go_models
    assert "hy3" in opencode_go_models


def test_age_guidance_json_has_all_buckets():
    guidance = json.loads((DATA_DIR / "age_guidance.json").read_text())
    assert set(guidance.keys()) == {"kids", "tween", "teen", "adult"}
    assert guidance["adult"] == ""
    assert "simple" in guidance["kids"].lower()
