// Picks the language before paint: the one chosen here before, else the browser's.
(() => {
  const LANGS = ["ko", "en", "ja", "zh"];
  const root = document.documentElement;
  let saved = null;
  try { saved = localStorage.getItem("lang"); } catch { /* private mode */ }
  const nav = (navigator.language || "").slice(0, 2).toLowerCase();
  const set = (l) => { root.dataset.lang = l; root.lang = l === "zh" ? "zh-Hans" : l; };
  set(LANGS.includes(saved) ? saved : LANGS.includes(nav) ? nav : "en");
  addEventListener("DOMContentLoaded", () => {
    const pick = document.getElementById("lang");
    pick.value = root.dataset.lang;
    pick.addEventListener("change", () => {
      set(pick.value);
      try { localStorage.setItem("lang", pick.value); } catch { /* private mode */ }
    });
  });
})();
