// static/js/ai-client.js
const AIClient = (() => {
  const WORKER_URL = "https://hero-journey-ai-relay.achappell.workers.dev";
  let ageGuidanceCache = null;

  async function getAgeGuidance(ageRange) {
    if (!ageGuidanceCache) {
      const res = await fetch("data/age_guidance.json");
      ageGuidanceCache = await res.json();
    }
    return ageGuidanceCache[ageRange] || "";
  }

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
          // Current Claude models think by default, and thinking tokens count
          // against max_tokens — leave headroom so a long weave isn't truncated.
          model,
          max_tokens: 8192,
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
      // Thinking is on by default on current Claude models, and thinking blocks
      // come first — scan for the text block rather than assuming content[0].
      const block = (data.content || []).find((b) => b.type === "text");
      if (!block) throw new Error("Anthropic returned no text content.");
      return block.text.trim();
    }
    const message = data.choices?.[0]?.message;
    if (!message || typeof message.content !== "string") {
      throw new Error("Provider returned no text content.");
    }
    return message.content.trim();
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

    let data;
    try {
      data = await res.json();
    } catch (err) {
      throw new Error(`API error ${res.status}`);
    }
    if (!res.ok) {
      throw new Error(data?.error?.message || `API error ${res.status}`);
    }
    return extractContent(settings.provider, data);
  }

  // Models are asked for a JSON array of questions, but they don't always
  // deliver valid JSON — unescaped quotes inside a question and stray preamble
  // are both common. Try strict JSON first, then salvage rather than failing
  // the whole turn over punctuation.
  function parseQuestionList(raw) {
    let content = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();

    const start = content.indexOf("[");
    const end = content.lastIndexOf("]");
    const bracketed = start !== -1 && end > start ? content.slice(start, end + 1) : content;

    try {
      const parsed = JSON.parse(bracketed);
      if (Array.isArray(parsed)) {
        return parsed.filter((q) => typeof q === "string" && q.trim()).map((q) => q.trim());
      }
    } catch (err) {
      /* fall through to salvage */
    }

    // Salvage 1: pull out quoted strings (survives a missing comma).
    const quoted = [...bracketed.matchAll(/"([^"\n]{2,})"/g)]
      .map((m) => m[1].trim())
      .filter(Boolean);
    if (quoted.length) return quoted;

    // Salvage 2: treat it as a plain list, one question per line.
    const lines = content
      .split("\n")
      .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").replace(/^["']|["'],?$/g, "").trim())
      .filter((l) => l.length > 2 && l !== "[" && l !== "]");
    if (lines.length) return lines;

    // Genuinely empty means "no more questions needed" — a valid outcome.
    if (/^\[\s*\]$/.test(bracketed)) return [];

    throw new Error(`Could not read questions from the model's reply: ${content.slice(0, 200)}`);
  }

  async function generateQuestions(stagePrompt, storySoFar, qAndA) {
    const settings = Settings.load();
    let systemMsg =
      "You are an expert storytelling guide. Your task is to guide the user in writing the next stage of their story. " +
      "Ask questions that are easy to answer, quick, and cut to the point. " +
      "Use a casual, conversational, and friendly tone in your questions. Avoid sounding overly formal or academic. " +
      "Based on the stage context, the story so far, and the questions the user has already answered, decide if more information is needed to write a complete entry. " +
      "If you have a full picture and no more questions are needed, output an empty JSON array []. " +
      "If more questions are needed, generate 1 to 2 new thought-provoking questions. " +
      "Output ONLY a valid JSON array of strings, e.g., [\"Question 1?\"], with no markdown formatting.";

    const guidance = await getAgeGuidance(settings.ageRange);
    if (guidance) systemMsg = `${guidance}\n\n${systemMsg}`;

    let qaText = "";
    if (qAndA.length > 0) {
      qaText = "\n\nUser's answers so far:\n" + qAndA.map((item) => `Q: ${item.q}\nA: ${item.a}`).join("\n");
    }
    const userMsg = `Story so far:\n${storySoFar || "(Beginning of the story)"}\n\nStage context: ${stagePrompt}${qaText}`;

    return parseQuestionList(await callChat(systemMsg, userMsg));
  }

  async function weaveAnswers(stagePrompt, storySoFar, qAndA) {
    const settings = Settings.load();
    let systemMsg =
      "You are an expert storyteller. The user has answered a series of guiding questions for a specific stage of the Hero's Journey. " +
      "Your task is to weave their answers into a cohesive, well-written narrative passage for this stage. " +
      "Use their ideas directly, adopting a descriptive and engaging tone that matches the story so far. " +
      "Output only the narrative text, no extra commentary.";

    const guidance = await getAgeGuidance(settings.ageRange);
    if (guidance) systemMsg = `${guidance}\n\n${systemMsg}`;

    const qaText = qAndA.map((item) => `Q: ${item.q}\nA: ${item.a}`).join("\n");
    const userMsg = `Story so far:\n${storySoFar || "(Beginning of the story)"}\n\nStage context: ${stagePrompt}\n\nUser's Q&A:\n${qaText}`;

    return callChat(systemMsg, userMsg);
  }

  return { generateQuestions, weaveAnswers };
})();
