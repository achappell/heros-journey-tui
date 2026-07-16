# Hero's Journey — AI Assist (Refine / Expand / Shorten / Next)

## Problem

The focus-grid editor (see `2026-07-15-focus-grid-web-design.md`) has no AI assistance. The
user wants, while a stage is focused: buttons to refine, expand, or shorten the current text via
an LLM, with a preview they can accept or reject before it overwrites their draft — plus a
"Next" button to move straight to the following stage without leaving the keyboard/mouse
context of the editor.

## Decision

Add a small backend proxy to OpenCode Zen's **Go** endpoint (the user's paid tier, not the free
`mimo-v2.5-free` model) and three new frontend controls plus a Next button, all scoped to the
focused card's footer.

The API key is never exposed to the browser — the Flask backend holds it server-side and the
frontend only ever talks to Flask's own `/api/ai/<action>` route.

## Backend

**New file `ai.py`:**
- `call_zen(action: str, content: str, prompt: str) -> str` — builds a system prompt per
  action, POSTs to `https://opencode.ai/zen/go/v1/chat/completions` with model `mimo-v2.5`,
  `Authorization: Bearer <OPENCODE_ZEN_API_KEY>`, returns the completion text.
- Raises a plain `RuntimeError` with a short message on any failure (network error, non-2xx
  response, missing/malformed response body) — `app.py` catches this and returns a JSON error,
  never a 500 with a stack trace.
- System prompts per action:
  - `refine`: "Improve clarity, grammar, and flow. Keep roughly the same length and preserve the author's voice and all factual content."
  - `expand`: "Add vivid, concrete descriptive detail to this passage. Elaborate on what's already there — don't introduce new plot events."
  - `shorten`: "Condense this passage to its essential meaning, cutting redundancy while preserving the key content."
  - All three system prompts are also told the stage's guiding prompt (e.g. "This is for the 'Ordinary World' stage: who is your hero before anything changes...") so suggestions stay on-topic.

**New route in `app.py`:**
- `POST /api/ai/<action>` where `action` is one of `refine`, `expand`, `shorten` (400 for
  anything else)
- Body: `{"content": str, "stage_prompt": str}`
- Success: `200 {"suggestion": str}`
- Failure: `502 {"error": str}` (a short, user-safe message — never leaks the API key or raw
  provider error internals)

**Key loading:**
- `python-dotenv` loads `.env` at `app.py` startup (`load_dotenv()` before `app = Flask(...)`)
- `OPENCODE_ZEN_API_KEY` is read once at startup into a module constant; if missing, the app
  still boots (so the rest of the tool works offline) but `/api/ai/*` returns
  `503 {"error": "AI features are not configured (missing OPENCODE_ZEN_API_KEY)"}` immediately
  without attempting a network call.
- Add `python-dotenv` to `requirements.txt`.
- `.env` stays gitignored (already the case); `.env.example` is added with a placeholder so a
  future setup step is obvious:
  ```
  OPENCODE_ZEN_API_KEY=sk-your-key-here
  ```

## Frontend

**Focused-card footer, below the textarea:**
- Three buttons: **Refine**, **Expand**, **Shorten**. Clicking one:
  - Disables all three AI buttons, changes the clicked one's label to "Thinking…"
  - POSTs to `/api/ai/<action>` with the textarea's current value and the stage's prompt
  - On success: renders a **preview block** between the prompt and the textarea, containing the
    suggested text (read-only) and two buttons, **Accept** and **Reject**
    - Accept: sets `textarea.value` to the suggestion, removes the preview block, refocuses the
      textarea, updates the live word count (reuses the existing `input`-listener word-count
      logic by calling it directly)
    - Reject: removes the preview block, textarea untouched
  - On failure: shows a small inline error line where the preview would go (e.g. "Couldn't
    reach the AI: <message>"), auto-dismissed on the next AI button click
  - Re-enables the three AI buttons in all cases (success, failure, reject, accept)
- Only one preview can be open at a time; clicking a different AI button while one is open
  discards the existing preview.

**Next button:**
- A separate button, always shown in the focused card's footer (distinct row from the AI
  buttons), labeled **Next →**
- Behavior: saves the current stage if its content changed (reuses `saveFocusedStage`'s save
  logic), then calls `focusStage(nextKey, nextIdx)` where `nextIdx = selectedIdx + 1`
- On stage 12 (`selectedIdx === stages.length - 1`), the button is not rendered (no
  wraparound, no disabled-but-visible state — simplest correct behavior for "you're done")

## Error handling
- All AI-call failures degrade gracefully: the editor and manual save/persistence keep working
  even if the AI backend is completely unreachable or misconfigured. No AI failure should ever
  block editing or saving.
- The `/api/ai/<action>` route validates `action` and the JSON body shape before calling
  `ai.py`, returning `400` for malformed requests without making a network call.

## Out of scope
- Streaming responses (full completion is fetched, then shown — no token-by-token UI).
- Configurable model/provider selection in the UI — `mimo-v2.5` via the Go endpoint is
  hardcoded, matching the user's actual current setup.
- Multi-turn chat / conversation history — each AI call is stateless, given only the current
  textarea content and the stage's prompt.
- Undo history beyond one level (accept overwrites; there's no redo-after-accept) — the
  existing save/reload flow is the safety net if a bad accept needs reverting.

## Testing
Manual verification only, consistent with the rest of the project: exercise all three AI
buttons against the real Zen Go endpoint, confirm Accept/Reject both behave correctly, confirm
Next saves-and-advances through all 12 stages and disappears on stage 12, and confirm the app
still boots and edits/saves normally with `OPENCODE_ZEN_API_KEY` unset (simulating a fresh
clone without the key configured).
