from __future__ import annotations

import json
from dataclasses import dataclass, field, asdict
from datetime import datetime
from pathlib import Path


@dataclass(frozen=True)
class StageTemplate:
    key: str
    title: str
    prompt: str


STAGES: list[StageTemplate] = [
    StageTemplate("ordinary_world", "1. Ordinary World",
        "Who is your hero before anything changes? Show their normal life, what they want, and what's missing."),
    StageTemplate("call_to_adventure", "2. Call to Adventure",
        "What event disrupts the ordinary world and presents a problem, challenge, or opportunity your hero can't ignore?"),
    StageTemplate("refusal_of_the_call", "3. Refusal of the Call",
        "Why does the hero hesitate? Fear, doubt, duty, or a taste of the risk ahead — show the reluctance before they commit."),
    StageTemplate("meeting_the_mentor", "4. Meeting the Mentor",
        "Who (or what) gives the hero the confidence, knowledge, or tools to move forward?"),
    StageTemplate("crossing_the_threshold", "5. Crossing the Threshold",
        "The hero commits and leaves the ordinary world behind. What's the point of no return, and what do they leave behind?"),
    StageTemplate("tests_allies_enemies", "6. Tests, Allies, and Enemies",
        "The hero learns the rules of the new world. Who do they team up with, who opposes them, and what smaller trials test them?"),
    StageTemplate("approach_inmost_cave", "7. Approach to the Inmost Cave",
        "The hero nears the central danger of the story. What preparations are made, and what rising tension signals the ordeal ahead?"),
    StageTemplate("ordeal", "8. Ordeal",
        "The central crisis — the hero's greatest fear or biggest test. What do they confront, and how do they nearly fail?"),
    StageTemplate("reward", "9. Reward (Seizing the Sword)",
        "Having survived the ordeal, what does the hero gain — an object, knowledge, reconciliation, or power?"),
    StageTemplate("road_back", "10. The Road Back",
        "The hero commits to finishing the journey home. What consequences of the ordeal chase them, or what choice recommits them to the goal?"),
    StageTemplate("resurrection", "11. Resurrection",
        "The final, highest-stakes test, where the hero is transformed for good. What's the climax, and who do they become through it?"),
    StageTemplate("return_with_elixir", "12. Return with the Elixir",
        "The hero returns changed, bringing something back that benefits their world. What's the elixir, and what does home look like now?"),
]


@dataclass
class Stage:
    key: str
    content: str = ""

    @property
    def word_count(self) -> int:
        return len(self.content.split()) if self.content.strip() else 0

    @property
    def status(self) -> str:
        if not self.content.strip():
            return "empty"
        if self.word_count < 50:
            return "started"
        return "done"

    def to_dict(self) -> dict:
        return {"key": self.key, "content": self.content}

    @classmethod
    def from_dict(cls, data: dict) -> Stage:
        return cls(key=data["key"], content=data.get("content", ""))


@dataclass
class StoryProject:
    title: str = "Untitled Story"
    stages: dict[str, Stage] = field(default_factory=dict)
    path: Path | None = None
    last_saved: str | None = None

    def __post_init__(self) -> None:
        for template in STAGES:
            self.stages.setdefault(template.key, Stage(key=template.key))

    def stage(self, key: str) -> Stage:
        return self.stages[key]

    @property
    def completed_count(self) -> int:
        return sum(1 for s in self.stages.values() if s.status == "done")

    def to_dict(self) -> dict:
        return {
            "title": self.title,
            "stages": {k: s.to_dict() for k, s in self.stages.items()},
        }

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(self.to_dict(), indent=2), encoding="utf-8")
        self.path = path
        self.last_saved = datetime.now().strftime("%H:%M:%S")

    @classmethod
    def load(cls, path: Path) -> StoryProject:
        data = json.loads(path.read_text(encoding="utf-8"))
        project = cls(title=data.get("title", "Untitled Story"))
        for key, raw in data.get("stages", {}).items():
            if key in project.stages:
                project.stages[key] = Stage.from_dict(raw)
        project.path = path
        return project


def stages_as_list() -> list[dict]:
    return [
        {"key": t.key, "title": t.title, "prompt": t.prompt}
        for t in STAGES
    ]
