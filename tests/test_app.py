import pytest
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
