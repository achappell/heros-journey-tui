import json
from pathlib import Path

DATA_DIR = Path(__file__).parent.parent / "static" / "data"


def test_models_json_is_valid():
    models = json.loads((DATA_DIR / "models.json").read_text())
    assert isinstance(models, list)
    assert models[0] == "mimo-v2.5"
    assert "grok-4.5" in models
    assert len(models) == 22


def test_age_guidance_json_has_all_buckets():
    guidance = json.loads((DATA_DIR / "age_guidance.json").read_text())
    assert set(guidance.keys()) == {"kids", "tween", "teen", "adult"}
    assert guidance["adult"] == ""
    assert "simple" in guidance["kids"].lower()
