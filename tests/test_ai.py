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
