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

  // Effort is spelled differently per provider: Anthropic takes it inside
  // output_config, the OpenAI-compatible shape takes a top-level
  // reasoning_effort. "default" means "don't send it at all".
  // Verified against each provider by probing the relay: "minimal" is rejected
  // by both OpenAI-compatible providers, "max" by OpenAI, and "xhigh"/"max" by
  // opencode-go's mimo models. These lists are the safe intersection.
  const EFFORT_LEVELS = {
    anthropic: ["low", "medium", "high", "xhigh", "max"],
    openai: ["low", "medium", "high", "xhigh"],
    "opencode-go": ["low", "medium", "high"],
  };

  function effortFor(provider, effort) {
    if (!effort || effort === "default") return null;
    return (EFFORT_LEVELS[provider] || []).includes(effort) ? effort : null;
  }

  function buildRequest(provider, apiKey, model, effort, systemMsg, userMsg) {
    const level = effortFor(provider, effort);

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
          ...(level ? { output_config: { effort: level } } : {}),
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
        ...(level ? { reasoning_effort: level } : {}),
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

  // Effort support is per-model, not per-provider — non-reasoning models
  // (claude-haiku-4-5, gpt-4.1, gpt-4o-mini) reject the parameter outright.
  // All three providers name it in the rejection message.
  function isEffortRejection(status, data) {
    if (status !== 400) return false;
    return /effort/i.test(data?.error?.message || "");
  }

  async function callChat(systemMsg, userMsg) {
    const settings = Settings.load();
    const apiKey = settings.apiKeys[settings.provider];
    if (!apiKey) {
      throw new Error(`No API key set. Open Settings and add your ${PROVIDER_LABELS[settings.provider]} key.`);
    }

    async function send(effort) {
      const { path, headers, body } = buildRequest(
        settings.provider, apiKey, settings.model, effort, systemMsg, userMsg
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
      return { res, data };
    }

    let { res, data } = await send(settings.effort);

    // Rather than fail the stage, drop the effort hint and take the model's
    // default. Only retried once, and only for this specific rejection.
    if (isEffortRejection(res.status, data)) {
      ({ res, data } = await send(null));
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

  async function reviseAnswers(stagePrompt, storySoFar, qAndA, previousText, feedback) {
    const settings = Settings.load();
    let systemMsg =
      "You are an expert storyteller. You previously wrote a narrative passage for a stage of the user's Hero's Journey story, " +
      "and the user has asked for changes. " +
      "Revise the passage according to their feedback while preserving everything they did not ask you to change — " +
      "keep the same events, characters, and details unless the feedback calls for altering them. " +
      "Output only the revised narrative text, no extra commentary and no explanation of what you changed.";

    const guidance = await getAgeGuidance(settings.ageRange);
    if (guidance) systemMsg = `${guidance}\n\n${systemMsg}`;

    const qaText = qAndA.map((item) => `Q: ${item.q}\nA: ${item.a}`).join("\n");
    const userMsg =
      `Story so far:\n${storySoFar || "(Beginning of the story)"}\n\n` +
      `Stage context: ${stagePrompt}\n\n` +
      `User's Q&A:\n${qaText}\n\n` +
      `The passage you wrote:\n${previousText}\n\n` +
      `What the user wants changed:\n${feedback}`;

    return callChat(systemMsg, userMsg);
  }

  return { generateQuestions, weaveAnswers, reviseAnswers, EFFORT_LEVELS };
})();
