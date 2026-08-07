# Multi-Provider AI (Claude + ChatGPT) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the static-site (GitHub Pages) build call Claude (Anthropic) or ChatGPT (OpenAI) in addition to the existing OpenCode Go provider, each with the user's own BYO API key.

**Architecture:** `static/data/models.json` becomes provider-keyed. `hj_settings` in `localStorage` gains a `provider` field and a per-provider `apiKeys` map (migrated from the old flat `apiKey` on read). The Settings panel gets a provider `<select>` that swaps the key field's label and repopulates the model list. `ai-client.js`'s `callChat` dispatches to one of three request/response adapters (OpenCode Go / OpenAI share the OpenAI-compatible chat-completions shape; Anthropic uses the Messages API shape). The Cloudflare Worker relay gains a routing table (path prefix → upstream host) instead of one hardcoded upstream, and passes through whatever auth headers the client sent instead of assuming `Authorization: Bearer`.

**Tech Stack:** Vanilla JS (no build step), Cloudflare Workers, `localStorage`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-07-multi-provider-ai-design.md` — read it if anything here is ambiguous.
- **Client-side only.** The Flask app (`app.py`, `ai.py`, `tests/`) is explicitly out of scope and must not be touched.
- Correct "OpenCode Zen" → "OpenCode Go" in the two static-site files that currently say it (`static/index.html`, `static/js/ai-client.js`). Do not touch historical plan docs under `docs/superpowers/plans/` — those are records of past work, not live copy.
- No build tooling, no JS test runner — matches the existing static site style. Each JS/Worker task is verified manually via the `run` skill (local static server) and, where a real network call is involved, real BYO keys.
- Provider ids used everywhere (code, JSON keys, `localStorage`): `opencode-go`, `anthropic`, `openai`. Don't invent alternate spellings.
- Default provider on first load (no saved settings): `opencode-go`, matching current behavior.

---

### Task 1: `static/data/models.json` — provider-keyed model lists

**Files:**
- Modify: `static/data/models.json`

**Interfaces:**
- Produces: `{ "opencode-go": string[], "anthropic": string[], "openai": string[] }` — consumed by `app.js` (Task 4) to populate the model `<select>` per provider.

- [ ] **Step 1: Rewrite the file**

```json
{
  "opencode-go": [
    "mimo-v2.5",
    "mimo-v2.5-pro",
    "mimo-v2-pro",
    "mimo-v2-omni",
    "minimax-m3",
    "minimax-m2.7",
    "minimax-m2.5",
    "kimi-k3",
    "kimi-k2.7-code",
    "kimi-k2.6",
    "kimi-k2.5",
    "glm-5.2",
    "glm-5.1",
    "glm-5",
    "deepseek-v4-pro",
    "deepseek-v4-flash",
    "qwen3.7-max",
    "qwen3.7-plus",
    "qwen3.6-plus",
    "qwen3.5-plus",
    "hy3-preview",
    "grok-4.5"
  ],
  "anthropic": [
    "claude-sonnet-5",
    "claude-opus-5",
    "claude-haiku-4-5"
  ],
  "openai": [
    "gpt-5.1",
    "gpt-5.1-mini",
    "gpt-5.1-nano"
  ]
}
```

(The `opencode-go` list is copied verbatim from the current file — no changes to those values, just nested under a key.)

- [ ] **Step 2: Verify it's valid JSON**

Run: `python3 -m json.tool static/data/models.json > /dev/null && echo OK`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add static/data/models.json
git commit -m "feat: nest model list under provider keys"
```

---

### Task 2: `static/js/settings.js` — provider + per-provider key storage

**Files:**
- Modify: `static/js/settings.js`

**Interfaces:**
- Produces: `Settings.load()` returns `{ provider, apiKeys: {opencode-go, anthropic, openai}, model, ageRange }`. `Settings.save(partial)` merges as before.
- Consumed by: `app.js` (Task 4) and `ai-client.js` (Task 5).

- [ ] **Step 1: Replace the file contents**

```javascript
// static/js/settings.js
const Settings = (() => {
  const KEY = "hj_settings";
  const DEFAULTS = {
    provider: "opencode-go",
    apiKeys: { "opencode-go": "", anthropic: "", openai: "" },
    model: "mimo-v2.5",
    ageRange: "adult",
  };

  function migrate(raw) {
    // Old shape had a flat `apiKey` field for the single provider that
    // existed at the time. Fold it into apiKeys.opencode-go once.
    if (raw && typeof raw.apiKey === "string" && !raw.apiKeys) {
      const { apiKey, ...rest } = raw;
      return { ...rest, apiKeys: { ...DEFAULTS.apiKeys, "opencode-go": apiKey } };
    }
    return raw;
  }

  function load() {
    try {
      const stored = JSON.parse(localStorage.getItem(KEY) || "{}");
      const migrated = migrate(stored) || {};
      return {
        ...DEFAULTS,
        ...migrated,
        apiKeys: { ...DEFAULTS.apiKeys, ...(migrated.apiKeys || {}) },
      };
    } catch (err) {
      return { ...DEFAULTS };
    }
  }

  function save(partial) {
    const merged = { ...load(), ...partial };
    localStorage.setItem(KEY, JSON.stringify(merged));
    return merged;
  }

  return { load, save };
})();
```

- [ ] **Step 2: Manually verify the migration in a browser console**

Run: `python3 -m http.server 8000 --directory static` (from repo root), open `http://localhost:8000`, then in devtools console:

```javascript
localStorage.setItem("hj_settings", JSON.stringify({apiKey: "old-key-123", model: "mimo-v2.5", ageRange: "adult"}));
location.reload();
Settings.load();
```

Expected: `{provider: "opencode-go", apiKeys: {"opencode-go": "old-key-123", anthropic: "", openai: ""}, model: "mimo-v2.5", ageRange: "adult"}`

- [ ] **Step 3: Verify fresh (no saved settings) load gives defaults**

Run in console: `localStorage.removeItem("hj_settings"); location.reload(); Settings.load();`
Expected: the `DEFAULTS` object shown above, with all `apiKeys` empty strings.

- [ ] **Step 4: Commit**

```bash
git add static/js/settings.js
git commit -m "feat: store per-provider API keys with migration from single key"
```

---

### Task 3: `static/index.html` — provider select + rename Zen→Go

**Files:**
- Modify: `static/index.html:26-33`

**Interfaces:**
- Produces: `#provider-select` element consumed by `app.js` (Task 4).

- [ ] **Step 1: Replace the settings panel markup**

Find:
```html
  <div id="settings-panel" class="settings-panel hidden">
    <h2>Settings</h2>
    <label>OpenCode Zen API Key
      <input type="password" id="api-key-input" placeholder="sk-...">
    </label>
    <label>Model
      <select id="model-select"></select>
    </label>
```

Replace with:
```html
  <div id="settings-panel" class="settings-panel hidden">
    <h2>Settings</h2>
    <label>Provider
      <select id="provider-select">
        <option value="opencode-go">OpenCode Go</option>
        <option value="anthropic">Anthropic (Claude)</option>
        <option value="openai">OpenAI (ChatGPT)</option>
      </select>
    </label>
    <label id="api-key-label">OpenCode Go API Key
      <input type="password" id="api-key-input" placeholder="sk-...">
    </label>
    <label>Model
      <select id="model-select"></select>
    </label>
```

- [ ] **Step 2: Commit**

```bash
git add static/index.html
git commit -m "feat: add provider selector to Settings panel"
```

---

### Task 4: `static/app.js` — wire provider selection into Settings panel

**Files:**
- Modify: `static/app.js` (the `initSettingsPanel` function, currently ~line 792-830)

**Interfaces:**
- Consumes: `#provider-select`, `#api-key-label`, `#api-key-input`, `#model-select` from Task 3; `Settings.load/save` from Task 2; `static/data/models.json` from Task 1.

- [ ] **Step 1: Replace `initSettingsPanel`**

Find the existing function (starts `async function initSettingsPanel() {`) and replace its body up through the model-select population and the apiKey/model change listeners with:

```javascript
async function initSettingsPanel() {
  const toggle = document.getElementById("settings-toggle");
  const panel = document.getElementById("settings-panel");
  const providerSelect = document.getElementById("provider-select");
  const apiKeyLabel = document.getElementById("api-key-label");
  const apiKeyInput = document.getElementById("api-key-input");
  const modelSelect = document.getElementById("model-select");
  const ageRangeSelect = document.getElementById("age-range-select");
  const exportBtn = document.getElementById("export-btn");
  const importInput = document.getElementById("import-input");
  const closeBtn = document.getElementById("settings-close");

  const PROVIDER_LABELS = {
    "opencode-go": "OpenCode Go API Key",
    anthropic: "Anthropic API Key",
    openai: "OpenAI API Key",
  };

  const modelsRes = await fetch("data/models.json");
  const modelsByProvider = await modelsRes.json();

  let settings = Settings.load();
  ageRangeSelect.value = currentStory.ageRange || settings.ageRange;

  function renderProvider() {
    providerSelect.value = settings.provider;
    apiKeyLabel.firstChild.textContent = PROVIDER_LABELS[settings.provider];
    apiKeyInput.value = settings.apiKeys[settings.provider] || "";

    const models = modelsByProvider[settings.provider] || [];
    modelSelect.innerHTML = models.map((m) => `<option value="${m}">${m}</option>`).join("");
    modelSelect.value = models.includes(settings.model) ? settings.model : models[0];
    if (modelSelect.value) settings = Settings.save({ model: modelSelect.value });
  }

  renderProvider();

  toggle.addEventListener("click", () => panel.classList.toggle("hidden"));
  closeBtn.addEventListener("click", () => panel.classList.add("hidden"));

  providerSelect.addEventListener("change", () => {
    settings = Settings.save({ provider: providerSelect.value });
    renderProvider();
  });

  apiKeyInput.addEventListener("change", () => {
    settings = Settings.save({
      apiKeys: { ...settings.apiKeys, [settings.provider]: apiKeyInput.value },
    });
  });

  modelSelect.addEventListener("change", () => {
    settings = Settings.save({ model: modelSelect.value });
  });

  ageRangeSelect.addEventListener("change", () => {
    Settings.save({ ageRange: ageRangeSelect.value });
    currentStory.ageRange = ageRangeSelect.value;
    StoryStore.save(currentStory);
  });

  exportBtn.addEventListener("click", () => StoryIO.exportStory(currentStory));
  importInput.addEventListener("change", async () => {
    const file = importInput.files[0];
    if (!file) return;
    try {
      const imported = await StoryIO.importStory(file);
      currentStory = imported;
      StoryStore.save(currentStory);
      location.reload();
    } catch (err) {
```

Everything from `catch (err) {` onward (the existing import-error handling and the rest of the function/file) is unchanged — only the block above it is replaced.

**Note:** `apiKeyLabel.firstChild.textContent` relies on the label's text node being its first child, which is true for the markup from Task 3 (`<label id="api-key-label">OpenCode Go API Key\n  <input ...>`). If this breaks visually, check that the `<label>` wasn't reformatted to put the `<input>` first.

- [ ] **Step 2: Manually verify in browser**

With the local static server running (`python3 -m http.server 8000 --directory static`), open `http://localhost:8000`, open Settings:
- Confirm the key label reads "OpenCode Go API Key" and the model dropdown shows the `opencode-go` model list.
- Switch provider to "Anthropic (Claude)" — confirm the label changes to "Anthropic API Key", the key field goes blank (assuming no key saved yet for that provider), and the model dropdown repopulates with the Claude model list.
- Type a fake key for Anthropic, switch to OpenAI, switch back to Anthropic — confirm the fake key persisted (per-provider storage working).

- [ ] **Step 3: Commit**

```bash
git add static/app.js
git commit -m "feat: wire provider selector to per-provider keys and model lists"
```

---

### Task 5: `static/js/ai-client.js` — per-provider request/response adapters

**Files:**
- Modify: `static/js/ai-client.js`

**Interfaces:**
- Consumes: `Settings.load()` (`provider`, `apiKeys`, `model`) from Task 2.
- Produces: `callChat(systemMsg, userMsg)` now provider-aware; `generateQuestions`/`weaveAnswers` unchanged externally.

- [ ] **Step 1: Replace `callChat` and the `WORKER_URL` usage**

Find:
```javascript
  async function callChat(systemMsg, userMsg) {
    const settings = Settings.load();
    if (!settings.apiKey) {
      throw new Error("No API key set. Open Settings and add your OpenCode Zen key.");
    }

    const res = await fetch(`${WORKER_URL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${settings.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: settings.model,
        messages: [
          { role: "system", content: systemMsg },
          { role: "user", content: userMsg },
        ],
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.error?.message || `API error ${res.status}`);
    }
    return data.choices[0].message.content.trim();
  }
```

Replace with:
```javascript
  const PROVIDER_LABELS = {
    "opencode-go": "OpenCode Go",
    anthropic: "Anthropic",
    openai: "OpenAI",
  };

  function buildRequest(provider, apiKey, model, systemMsg, userMsg) {
    if (provider === "anthropic") {
      return {
        path: "/anthropic/v1/messages",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: {
          model,
          max_tokens: 4096,
          system: systemMsg,
          messages: [{ role: "user", content: userMsg }],
        },
      };
    }

    // opencode-go and openai both use the OpenAI-compatible chat-completions shape.
    const routePrefix = provider === "openai" ? "/openai" : "/opencode";
    return {
      path: `${routePrefix}/v1/chat/completions`,
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: {
        model,
        messages: [
          { role: "system", content: systemMsg },
          { role: "user", content: userMsg },
        ],
      },
    };
  }

  function extractContent(provider, data) {
    if (provider === "anthropic") {
      return data.content[0].text.trim();
    }
    return data.choices[0].message.content.trim();
  }

  async function callChat(systemMsg, userMsg) {
    const settings = Settings.load();
    const apiKey = settings.apiKeys[settings.provider];
    if (!apiKey) {
      throw new Error(`No API key set. Open Settings and add your ${PROVIDER_LABELS[settings.provider]} key.`);
    }

    const { path, headers, body } = buildRequest(
      settings.provider, apiKey, settings.model, systemMsg, userMsg
    );

    const res = await fetch(`${WORKER_URL}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.error?.message || `API error ${res.status}`);
    }
    return extractContent(settings.provider, data);
  }
```

- [ ] **Step 2: Manually verify request shape without a real key (expect a clean auth error, not a crash)**

With the local static server running and Settings → Anthropic selected with a fake key like `"fake"`, trigger a guided-flow question generation (click an empty stage). Open devtools Network tab, confirm the request went to `{WORKER_URL}/anthropic/v1/messages` with `x-api-key: fake` and `anthropic-version: 2023-06-01` headers and the `system`/`messages` body shape described above. Expect the app to show a readable error (not a raw exception) since Task 6 (Worker routing) isn't deployed yet at this point — a fetch failure or 404 is fine here, this step is only checking the *request* shape via devtools, not a full round trip.

- [ ] **Step 3: Commit**

```bash
git add static/js/ai-client.js
git commit -m "feat: add per-provider request/response adapters to ai-client"
```

---

### Task 6: `cloudflare-worker/worker.js` — multi-host routing

**Files:**
- Modify: `cloudflare-worker/worker.js`

**Interfaces:**
- Consumes: requests from `ai-client.js` (Task 5) with paths `/opencode/...`, `/openai/...`, `/anthropic/...`.
- Produces: forwards to the matched upstream host, passing through whatever headers the client sent.

- [ ] **Step 1: Replace the file**

```javascript
const ROUTES = {
  "/opencode": "https://opencode.ai/zen/go",
  "/openai": "https://api.openai.com",
  "/anthropic": "https://api.anthropic.com",
};

function matchRoute(pathname) {
  for (const prefix of Object.keys(ROUTES)) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      return { prefix, host: ROUTES[prefix] };
    }
  }
  return null;
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "authorization, x-api-key, anthropic-version, content-type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const route = matchRoute(url.pathname);
    if (!route) {
      return new Response(JSON.stringify({ error: { message: "Unknown route" } }), {
        status: 404,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const upstreamPath = url.pathname.slice(route.prefix.length);
    const upstreamUrl = `${route.host}${upstreamPath}${url.search}`;

    const forwardedHeaders = new Headers();
    for (const [key, value] of request.headers) {
      if (["authorization", "x-api-key", "anthropic-version", "content-type"].includes(key.toLowerCase())) {
        forwardedHeaders.set(key, value);
      }
    }

    const upstreamRequest = new Request(upstreamUrl, {
      method: request.method,
      headers: forwardedHeaders,
      body: request.method === "GET" ? undefined : await request.text(),
    });

    const upstreamResponse = await fetch(upstreamRequest);
    const responseBody = await upstreamResponse.text();

    return new Response(responseBody, {
      status: upstreamResponse.status,
      headers: {
        "Content-Type": upstreamResponse.headers.get("Content-Type") || "application/json",
        ...corsHeaders,
      },
    });
  },
};
```

- [ ] **Step 2: Deploy and verify each route manually**

Run: `cd cloudflare-worker && wrangler deploy`

Then, with real BYO keys, verify each provider with a direct `curl` (replace placeholders):

```bash
# OpenCode Go (existing behavior, should be unchanged)
curl -s https://hero-journey-ai-relay.achappell.workers.dev/opencode/v1/chat/completions \
  -H "Authorization: Bearer $OPENCODE_KEY" -H "Content-Type: application/json" \
  -d '{"model":"mimo-v2.5","messages":[{"role":"user","content":"say hi"}]}'

# OpenAI
curl -s https://hero-journey-ai-relay.achappell.workers.dev/openai/v1/chat/completions \
  -H "Authorization: Bearer $OPENAI_KEY" -H "Content-Type: application/json" \
  -d '{"model":"gpt-5.1-mini","messages":[{"role":"user","content":"say hi"}]}'

# Anthropic
curl -s https://hero-journey-ai-relay.achappell.workers.dev/anthropic/v1/messages \
  -H "x-api-key: $ANTHROPIC_KEY" -H "anthropic-version: 2023-06-01" -H "Content-Type: application/json" \
  -d '{"model":"claude-haiku-4-5","max_tokens":100,"messages":[{"role":"user","content":"say hi"}]}'
```

Expected: each returns a 200 with a real completion (OpenAI/OpenCode: `choices[0].message.content`; Anthropic: `content[0].text`). No CORS headers to check here since `curl` isn't a browser, but confirm no 404/500 from the Worker itself.

- [ ] **Step 3: Commit**

```bash
git add cloudflare-worker/worker.js
git commit -m "feat: route Worker relay to opencode-go/openai/anthropic by path prefix"
```

---

### Task 7: End-to-end manual verification in the browser

**Files:** none (verification only)

> **⚠️ DEPLOY-BEFORE-MERGE WARNING:** The Cloudflare Worker (`cloudflare-worker/worker.js`) must be deployed via `wrangler deploy` **before** this branch merges to `main` and GitHub Pages auto-publishes the new frontend. If the frontend goes live first, existing OpenCode Go users will hit the currently-undeployed Worker, which won't recognize the new `/opencode/...` path prefix — breaking a previously-working feature for real users during the gap. Deploy the Worker first, then merge.

- [ ] **Step 1: Full round trip per provider**

With the local static server running and pointed at the deployed Worker (already the case — `WORKER_URL` is a fixed deployed URL, not localhost), for each of the three providers:
1. Open Settings, select the provider, paste a real key, pick a model.
2. Click an empty stage to trigger guided-flow question generation.
3. Confirm real questions come back and render.
4. Answer a question and confirm "weave answers" produces real narrative text.

- [ ] **Step 2: Confirm existing OpenCode Go users aren't broken**

In a fresh browser profile (or after clearing `localStorage`), seed the *old* settings shape (`{apiKey: "<real opencode key>", model: "mimo-v2.5", ageRange: "adult"}`) as in Task 2 Step 2, reload, and confirm a real AI call still works without re-entering the key — this proves the migration path works end-to-end, not just in isolation.

- [ ] **Step 3: Error path check**

Clear the Anthropic key (leave it blank), select Anthropic as the provider, trigger a guided-flow action. Confirm the app shows the readable error `No API key set. Open Settings and add your Anthropic key.` rather than a crash or blank failure.

No commit for this task — it's verification of Tasks 1-6.
