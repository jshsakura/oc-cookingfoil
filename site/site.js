// Language and theme, decided before paint and remembered between pages.
(() => {
  const LANGS = { ko: "한국어", en: "English", ja: "日本語", zh: "中文" };
  const THEMES = ["auto", "dark", "light"];
  const root = document.documentElement;
  const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const write = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

  const setLang = (l) => { root.dataset.lang = l; root.lang = l === "zh" ? "zh-Hans" : l; };
  const nav = (navigator.language || "").slice(0, 2).toLowerCase();
  const saved = read("lang");
  setLang(saved in LANGS ? saved : nav in LANGS ? nav : "en");

  const setTheme = (t) => { if (t === "auto") delete root.dataset.theme; else root.dataset.theme = t; };
  const savedTheme = read("theme");
  setTheme(THEMES.includes(savedTheme) ? savedTheme : "auto");

  addEventListener("DOMContentLoaded", () => {
    const btn = document.getElementById("lang-btn");
    const menu = document.getElementById("lang-menu");
    const code = document.getElementById("lang-code");
    const close = () => { menu.hidden = true; btn.setAttribute("aria-expanded", "false"); };
    const sync = () => {
      code.textContent = root.dataset.lang.toUpperCase();
      for (const b of menu.querySelectorAll("button")) b.setAttribute("aria-checked", String(b.dataset.lang === root.dataset.lang));
    };
    for (const [l, name] of Object.entries(LANGS)) {
      const b = document.createElement("button");
      b.type = "button"; b.role = "menuitemradio"; b.dataset.lang = l; b.lang = l; b.textContent = name;
      b.addEventListener("click", () => { setLang(l); write("lang", l); sync(); close(); btn.focus(); });
      menu.append(b);
    }
    btn.addEventListener("click", () => {
      const open = menu.hidden;
      menu.hidden = !open; btn.setAttribute("aria-expanded", String(open));
      if (open) menu.querySelector('[aria-checked="true"]')?.focus();
    });
    addEventListener("click", (e) => { if (!e.target.closest(".lang")) close(); });
    addEventListener("keydown", (e) => { if (e.key === "Escape" && !menu.hidden) { close(); btn.focus(); } });
    sync();

    const theme = document.getElementById("theme-btn");
    const showTheme = () => {
      const t = root.dataset.theme ?? "auto";
      theme.title = { auto: "Theme: auto", dark: "Theme: dark", light: "Theme: light" }[t];
    };
    theme.addEventListener("click", () => {
      const next = THEMES[(THEMES.indexOf(root.dataset.theme ?? "auto") + 1) % THEMES.length];
      setTheme(next); write("theme", next); showTheme();
    });
    showTheme();
  });
})();
