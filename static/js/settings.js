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
    const current = load();
    const merged = {
      ...current,
      ...partial,
      apiKeys: { ...current.apiKeys, ...(partial.apiKeys || {}) },
    };
    localStorage.setItem(KEY, JSON.stringify(merged));
    if (typeof window.gtag === 'function') {
      window.gtag('event', 'change_settings', {
        provider: merged.provider,
        model: merged.model,
        age_range: merged.ageRange
      });
    }
    return merged;
  }

  return { load, save };
})();
