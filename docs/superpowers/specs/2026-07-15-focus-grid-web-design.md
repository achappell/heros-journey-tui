# Hero's Journey — Focus Grid Web App

## Problem

Three prior implementations exist for the same idea (Python Textual TUI, Go/bubbletea TUI,
Flask web app with a modal editor) plus one disconnected static prototype
(`grid-prototype.html`). None matches the intended interaction: a grid of all 12 stages where
focusing one expands it in place, the rest shrink and reflow, and content density changes with
focus state. Terminal UIs can't do smooth animated reflow, so a TUI was never the right medium.
The Flask app's modal-overlay editor also doesn't match — focusing should expand *in place*, not
pop up on top.

## Decision

Keep the Flask/Python backend (already correct: dataclass models, JSON persistence, REST
endpoints). Replace the frontend with an evolution of `grid-prototype.html`'s CSS Grid
expand-in-place pattern, wired to real data, with a third "summary" content state added.
Delete every other implementation.

## Scope

**Keep and relocate to project root:**
- `heros-journey-web/app.py`, `models.py`, `requirements.txt` → project root
- `heros-journey-web/static/` → project root `static/` (contents rewritten, see below)

**Delete:**
- `main.go`, `heros-journey` (compiled binary), `go.mod`, `go.sum`
- `heros_journey/` (Textual TUI package)
- root `main.py`, root `requirements.txt`
- `grid-prototype.html` (superseded — its pattern is folded into the new frontend)
- both `.venv/` directories, `__pycache__/`
- `heros-journey-web/` (emptied by the relocation above)

**Rewrite:**
- `static/index.html`, `static/app.js`, `static/style.css`

## Backend (unchanged behavior)

No API or model changes. Existing endpoints remain:
- `GET /api/stages` — 12 stage templates (key, title, prompt)
- `GET /api/story` — saved content, word counts, status per stage
- `PUT /api/story/stage/<key>` — save one stage's content, returns updated word count/status

## Frontend

### Layout
CSS Grid, 4 columns × 3 rows, one card per stage. `grid-prototype.html`'s transition approach
carries over: `transition: all .35s cubic-bezier(0.4, 0, 0.2, 1)` on cards, focused card spans
2 columns × 2 rows.

### State
Single `focusedKey` (or `null`) drives all card rendering. No per-card state beyond that plus
the fetched `stages` array (`{key, num, title, prompt, content, wordCount, status}`).

### Three content states per card

| State | When | Shows |
|---|---|---|
| **collapsed** | another card is focused | number + title only, compact size |
| **idle** | nothing focused | number, title, prompt, one-line content summary (first ~12 words of saved content, or "—" if empty), status dot |
| **focused** | this card is focused | number, title, full prompt, inline `<textarea>` pre-filled with content, autofocused |

### Interaction
- Click a card, or arrow-key to select + Enter → focuses it (sets `focusedKey`)
- Esc, or clicking the focused card again → saves (if changed) and clears `focusedKey`
- Arrow keys move a selection cursor when nothing is focused (reuses existing 4-column-aware
  nav logic from the current `app.js`)
- `Cmd/Ctrl+S` while focused saves without collapsing

### Save
Fires on: textarea blur, Esc/collapse, and `Cmd/Ctrl+S`. Each save is a single
`PUT /api/story/stage/<key>` call (no debounce needed — not per-keystroke). Response updates
local state (`wordCount`, `status`) and re-renders the grid.

## Out of scope
- Editable story title, multi-story picker, markdown export — unchanged from the prior
  "possible next steps" list, not part of this pass.
- Mobile/responsive layout — desktop-first for now.

## Testing
Manual verification only (per `verify` skill after implementation): load the app, focus each
state transition (idle → focused → collapsed for siblings), confirm save round-trips through a
page reload, confirm keyboard nav still works when nothing is focused.
