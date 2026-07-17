import pytest
from unittest.mock import patch
from app import app, get_project

@pytest.fixture
def client():
    app.config["TESTING"] = True
    with app.test_client() as client:
        yield client

def test_get_stages(client):
    response = client.get("/api/stages")
    assert response.status_code == 200
    data = response.get_json()
    assert len(data) > 0
    assert data[0]["key"] == "ordinary_world"

def test_get_story(client):
    response = client.get("/api/story")
    assert response.status_code == 200
    data = response.get_json()
    assert "title" in data
    assert "stages" in data


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
