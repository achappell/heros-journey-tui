import pytest
from ai import generate_questions
from unittest.mock import patch

@patch("ai.requests.post")
def test_generate_questions(mock_post):
    mock_post.return_value.status_code = 200
    mock_post.return_value.json.return_value = {
        "choices": [{"message": {"content": '["What happens next?"]'}}]
    }
    
    questions = generate_questions("prompt", "story so far", [], "fake_key")

    assert questions == ["What happens next?"]
    # Verify that verify=False was passed
    mock_post.assert_called_once()
    assert mock_post.call_args[1].get("verify") is False


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
