# Multi-provider AI (Claude + ChatGPT) — Design

## Goal

Let the static-site (GitHub Pages) build call Claude (Anthropic) or ChatGPT
(OpenAI) in addition to the existing OpenCode Go provider, each with the
user's own BYO API key. The local Flask app is untouched — it stays
OpenCode Go only, per `docs/superpowers/specs/2026-07-17-static-site-byok-design.md`.

Note: the existing single provider is **OpenCode Go**, not "OpenCode Zen" —
that name is corrected everywhere in this work (Settings label, error
messages). The upstream URL itself (`opencode.ai/zen/go`) is unchanged.

## Scope

Client-side only: `static/js/settings.js`, `static/js/ai-client.js`,
`static/index.html`, `static/app.js` (settings panel wiring),
`static/data/models.json`, `cloudflare-worker/worker.js`.

## Data & storage model

`static/data/models.json` becomes provider-keyed instead of a flat array:

```json
{
  "opencode-go": ["mimo-v2.5", "mimo-v2.5-pro", "mimo-v2-pro", "..."],
  "anthropic": ["claude-sonnet-5", "claude-haiku-4-5", "..."],
  "openai": ["gpt-5.1", "gpt-5.1-mini", "..."]
}
```

`localStorage` key `hj_settings` gains a `provider` field and moves from a
single `apiKey` to a per-provider map:

```json
{
  "provider": "opencode-go",
  "apiKeys": { "opencode-go": "...", "anthropic": "", "openai": "" },
  "model": "mimo-v2.5",
  "ageRange": "adult"
}
```

`Settings.load()` migrates the old flat shape (`{apiKey, model, ageRange}`)
on first read: if `apiKeys` is absent but `apiKey` is present, it becomes
`apiKeys.opencode-go` and `provider` defaults to `"opencode-go"`. This is a
one-time, read-time migration — no explicit version field needed since the
presence of `apiKeys` is itself the marker.

## Settings UI (`static/index.html` + `app.js`)

Add a provider `<select id="provider-select">` above the existing API key
input, with options OpenCode Go / Anthropic (Claude) / OpenAI (ChatGPT).

- The key input's label and placeholder update to match the selected
  provider ("OpenCode Go API Key" / "Anthropic API Key" / "OpenAI API Key").
- The key input's value is read from and written to
  `settings.apiKeys[provider]` rather than a flat `apiKey` field.
- Changing the provider re-populates `model-select` from
  `models.json[provider]` and resets the selection to that provider's first
  model (or the saved model if it's still valid for the new provider).
- Age range `<select>` is unchanged.

## `ai-client.js` — per-provider request/response adapters

`callChat(systemMsg, userMsg)` reads `settings.provider` and dispatches to
one of three request builders, all funneled through the same
`WORKER_URL` with a provider-specific path prefix:

- **`opencode-go`** → `POST {WORKER_URL}/opencode/v1/chat/completions`
  (unchanged from today, just prefixed)
- **`openai`** → `POST {WORKER_URL}/openai/v1/chat/completions`
  Same OpenAI-compatible chat-completions shape as OpenCode Go:
  `messages: [{role:"system",...}, {role:"user",...}]`, response at
  `data.choices[0].message.content`. Auth: `Authorization: Bearer <key>`.
- **`anthropic`** → `POST {WORKER_URL}/anthropic/v1/messages`
  Anthropic Messages API shape: `system: systemMsg` as a top-level field,
  `messages: [{role:"user", content: userMsg}]` (no system-role message),
  `max_tokens: 4096`. Auth: `x-api-key: <key>` + `anthropic-version:
  2023-06-01` headers (no `Authorization` header). Response read from
  `data.content[0].text`.

A shared error-normalization step keeps the existing behavior of throwing
`Error(message)` on non-2xx responses, extracting the message from whichever
shape the failing provider returns (`data.error.message` for
OpenAI/OpenCode, `data.error.message` for Anthropic too — both use that
shape for error bodies).

`generateQuestions` and `weaveAnswers` are unchanged apart from calling the
updated `callChat` — they don't need to know which provider is active.

## Cloudflare Worker — multi-host relay (`cloudflare-worker/worker.js`)

Replace the single hardcoded `UPSTREAM` with a routing table matched
against the request path prefix:

```js
const ROUTES = {
  "/opencode": "https://opencode.ai/zen/go",
  "/openai": "https://api.openai.com",
  "/anthropic": "https://api.anthropic.com",
};
```

The Worker strips the matched prefix, forwards the remaining
path/method/body to the resolved host, and passes through whatever
headers the client sent (`Authorization` for OpenAI/OpenCode-Go,
`x-api-key`/`anthropic-version` for Anthropic) rather than hardcoding one
auth header name. CORS headers and `OPTIONS` handling are unchanged. If no
route matches the prefix, return 404. The Worker still has no knowledge of
request/response body shape — it's a dumb relay, same as today, just with
three upstreams instead of one.

## Testing

No existing JS test harness (per the BYOK design doc, static-site testing
is manual). Manual verification via the `run` skill / local static server:

- Settings panel: switching provider swaps the key field label/placeholder
  and repopulates the model list correctly.
- Existing OpenCode Go users: confirm the migration reads their old saved
  key into `apiKeys.opencode-go` without requiring re-entry.
- One real AI call (question generation or weave) through each of the three
  providers via the deployed Worker, using real BYO keys.
- Error path: an invalid/missing key for the selected provider surfaces a
  readable error message (matching today's "No API key set" / API error
  behavior), not a raw JSON dump or silent failure.

## Out of scope

- Flask/local app (`app.py`, `ai.py`) — stays OpenCode Go only.
- No provider auto-detection or fallback between providers on failure.
- No streaming responses (all three providers called in non-streaming
  mode, matching current behavior).
- No change to the `refine`/`expand`/`shorten` actions in `ai.py` — those
  are server-side-only code paths not currently wired to the static
  frontend, and are out of scope here.
