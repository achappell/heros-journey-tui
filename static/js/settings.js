// static/js/settings.js
const Settings = (() => {
  const KEY = "hj_settings";
  const DEFAULTS = { apiKey: "", model: "mimo-v2.5", ageRange: "adult" };

  function load() {
    try {
      return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
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
