# Static site + BYO-key + age-tailored prompting — Design

## Goal

Publish Hero's Journey Builder to GitHub Pages so anyone can use it with their
own OpenCode Zen API key and choice of model, while keeping the existing
Flask/Python app working locally as a separate mode. Add an age-range setting
that tailors AI question-generation and story-weaving output.

## Two deployment modes

### 1. Local Flask app (kept)

Stays architecturally as-is (`app.py`, `ai.py`, `models.py`, `prompts/`).
Changes:
- `StoryProject` gains an `age_range` field (`kids | tween | teen | adult`),
  persisted in `story.json`.
- `/api/ai/*` routes accept a `model` field in the request body (falling back
  to `mimo-v2.5` if absent) instead of hardcoding it.
- `ai.py` functions take an `age_range` parameter and prepend age guidance to
  the system prompt (see "Age tailoring" below).
- New `GET /api/models` route returns the static model list (see "Model
  list") so the frontend doesn't hardcode it twice.
- This mode keeps using the server-held `OPENCODE_ZEN_API_KEY` env var — it's
  single-user/local, so no BYO-key UI here.

### 2. Static site (new, GitHub Pages)

A client-side-only rebuild of `static/`, deployed via GitHub Actions.

**Data storage (`localStorage`):**
- `hj_settings`: `{ apiKey, model, ageRange }` — persists across visits.
- `hj_story`: the story object (title, stages, timestamps) — replaces the
  Flask `/api/story` GET/PUT round trip.
- Export button downloads `hj_story` as `story.json`; Import button reads a
  `.json` file back into `localStorage` and re-renders. This is the backup/
  portability path since there's no server-side file anymore.

**AI calls:** browser → Cloudflare Worker → OpenCode Zen.
- The Worker is a thin relay: forwards method/body/`Authorization` header
  as-is to `https://opencode.ai/zen/go/v1/chat/completions` (or `/v1/models`),
  and adds `Access-Control-Allow-Origin: *` (or the Pages origin) plus
  `Access-Control-Allow-Headers: authorization,content-type` and handles the
  `OPTIONS` preflight. It stores nothing and logs nothing sensitive.
- Confirmed via direct testing: `https://opencode.ai/zen/go/v1/chat/completions`
  returns no CORS headers and 404s on `OPTIONS`, so direct browser calls are
  blocked by the browser regardless of key validity — the relay is required,
  not optional.
- The static JS reads `apiKey`/`model` from `hj_settings` and calls the
  Worker URL instead of `/api/ai/...`.

**Settings panel (new UI):** API key input, model `<select>`, age-range
`<select>`. Rendered inline (e.g. a gear icon opening a small panel), not a
separate page.

## Model list

Confirmed from `https://opencode.ai/zen/go/v1/models` (the endpoint the app
actually calls — note this is a *different, smaller* list than the general
`https://opencode.ai/zen/v1/models`):

```
minimax-m3, minimax-m2.7, minimax-m2.5,
kimi-k3, kimi-k2.7-code, kimi-k2.6, kimi-k2.5,
glm-5.2, glm-5.1, glm-5,
deepseek-v4-pro, deepseek-v4-flash,
qwen3.7-max, qwen3.7-plus, qwen3.6-plus, qwen3.5-plus,
mimo-v2-pro, mimo-v2-omni, mimo-v2.5-pro, mimo-v2.5,
hy3-preview, grok-4.5
```

Default selection: `mimo-v2.5` (current hardcoded default). This list is
hardcoded once as a small JSON/JS constant (shared by both Flask's
`/api/models` route and the static JS) rather than fetched live, since it
rarely changes and avoids an extra request on load.

## Age tailoring

Four buckets, each mapping to a short guidance string appended to every AI
system prompt (question generation, weave, refine/expand/shorten):

- **Kids** (~6-9): simple vocabulary, short sentences, gentle themes — no
  violence, death, or scary content; conflicts resolve kindly.
- **Tween** (~10-12): clear vocabulary, moderate sentence complexity, mild
  peril allowed but nothing graphic or disturbing.
- **Teen** (~13-17): natural YA-novel register, real stakes and conflict
  allowed, avoid graphic violence/content.
- **Adult** (default, matches current behavior): no added constraints.

This guidance text lives in one place — `prompts/age_guidance.json` (a
`{bucket: string}` map) — read by `ai.py` on the Flask side and fetched as a
static asset by the frontend JS on the static-site side, so both modes share
the exact same wording.

`age_range` is a per-story setting (stored alongside the story data, not a
separate global preference), matching that a story has one target audience
throughout.

## Deployment

- New public GitHub repo, created via `gh repo create`, pushed from `main`.
- `.github/workflows/deploy-pages.yml`: on push to `main`, uploads the static
  frontend folder as a Pages artifact and deploys via
  `actions/deploy-pages`. Flask/Python files are excluded from the published
  artifact (only the static folder ships).
- Cloudflare Worker deployed separately, once, via `wrangler deploy` under
  the existing Cloudflare account. Its URL is hardcoded into the static JS
  as the AI endpoint base.

## Testing

- Existing Python tests (`tests/`) extended to cover `age_range` persistence
  and the `model` passthrough in `ai.py`/`app.py`.
- Static site: manual verification via `run` skill / local static server,
  since there's no existing JS test harness — confirm settings panel,
  localStorage round-trip, export/import, and a real AI call through the
  deployed Worker.

## Out of scope

- No user accounts, no server-side story storage for the static site.
- No live-fetching the OpenCode model list at runtime (hardcoded instead).
- No changes to the 12-stage content/prompts themselves beyond the age
  guidance prefix.
