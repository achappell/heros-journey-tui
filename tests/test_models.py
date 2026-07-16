from models import StoryProject

def test_story_project_initialization():
    project = StoryProject()
    assert project.title == "Untitled Story"
    assert "call_to_adventure" in project.stages
    assert project.stages["call_to_adventure"].status == "empty"

def test_story_project_save_load(tmp_path):
    project = StoryProject()
    project.title = "Test Story"
    # To get "done" status, we need >= 50 words
    content = "word " * 55
    project.stages["call_to_adventure"].content = content
    
    save_file = tmp_path / "story.json"
    project.save(save_file)
    
    loaded_project = StoryProject.load(save_file)
    assert loaded_project.title == "Test Story"
    assert loaded_project.stages["call_to_adventure"].status == "done"
    assert loaded_project.stages["call_to_adventure"].content == content
