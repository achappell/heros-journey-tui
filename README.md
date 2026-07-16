# Hero's Journey Builder

A web app for drafting a story stage by stage through the 12-stage Hero's
Journey (Vogler's adaptation of Campbell's monomyth).

All 12 stages are visible at once in a grid. Focusing a stage — by clicking
it or selecting it with arrow keys and pressing Enter — expands it in place:
the other stages shrink to a compact strip while the focused stage shows its
full prompt and an editable text area.

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Run

```bash
python app.py
```

Then open http://127.0.0.1:5001 in a browser.

Stories autosave to `~/Documents/HeroJourneyStories/story.json`.

## Keybindings

| Key             | Action                                        |
|-----------------|------------------------------------------------|
| `↑` `↓` `←` `→` | Move the selection cursor (grid view)          |
| `Enter` / click | Focus the selected/clicked stage               |
| `Esc`           | Save and collapse the focused stage            |
| `⌘/Ctrl+S`      | Save the focused stage without collapsing      |

## Project layout

```
app.py         — Flask app: serves the frontend, exposes the story API
models.py      — the 12 stage templates + StoryProject (save/load as JSON)
static/
  index.html   — page shell
  app.js       — grid state, rendering, keyboard nav, save
  style.css    — grid layout and the collapsed/idle/focused card states
```

## Possible next steps

- Editable story/project title (currently fixed as "Untitled Story")
- Export to Markdown
- Multiple saved stories with a picker on launch
- Per-stage target word counts / progress bar
