// static/js/ai-client.js
const AIClient = (() => {
  const WORKER_URL = "https://REPLACE_ME.workers.dev"; // updated in Task 9 after the Worker is deployed
  let ageGuidanceCache = null;

  async function getAgeGuidance(ageRange) {
    if (!ageGuidanceCache) {
      const res = await fetch("data/age_guidance.json");
      ageGuidanceCache = await res.json();
    }
    return ageGuidanceCache[ageRange] || "";
  }

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

    let content = (await callChat(systemMsg, userMsg)).trim();
    if (content.startsWith("```json")) content = content.slice(7);
    if (content.startsWith("```")) content = content.slice(3);
    if (content.endsWith("```")) content = content.slice(0, -3);
    return JSON.parse(content.trim());
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
