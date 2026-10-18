// Language and theme, decided before paint and remembered between pages, plus the start screen on the home page.
(() => {
  const LANGS = { ko: "한국어", en: "English", ja: "日本語", zh: "中文" };
  const THEMES = ["light", "dark", "auto"];
  const root = document.documentElement;
  const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const write = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

  const langListeners = [];
  const setLang = (l) => { root.dataset.lang = l; root.lang = l === "zh" ? "zh-Hans" : l; for (const f of langListeners) f(l); };
  const nav = (navigator.language || "").slice(0, 2).toLowerCase();
  const saved = read("lang");
  setLang(saved in LANGS ? saved : nav in LANGS ? nav : "en");

  const setTheme = (t) => { root.dataset.theme = t; };
  const savedTheme = read("theme");
  setTheme(THEMES.includes(savedTheme) ? savedTheme : "light");

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
      const t = root.dataset.theme;
      theme.title = { auto: "Theme: auto", dark: "Theme: dark", light: "Theme: light" }[t];
    };
    theme.addEventListener("click", () => {
      const next = THEMES[(THEMES.indexOf(root.dataset.theme) + 1) % THEMES.length];
      setTheme(next); write("theme", next); showTheme();
    });
    showTheme();
    startSplash(langListeners);
  });
})();

// The client's start screen: the butter lands once a second, the bar fills over three landings,
// and each full bar brings the next line. The chime waits for a landing, as it does on the console.
function startSplash(langListeners) {
  const butter = document.querySelector("#butter .butter");
  const bar = document.getElementById("bar");
  const line = document.getElementById("line");
  const chimeBtn = document.getElementById("chime");
  if (!butter || !bar || !line) return;
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;

  let lines = [];
  let at = 0;
  const show = (animate) => {
    const entry = lines[at];
    if (!entry) return;
    line.textContent = entry[document.documentElement.dataset.lang] ?? entry.en;
    if (!animate) return;
    line.classList.remove("swap");
    void line.offsetWidth;
    line.classList.add("swap");
  };
  const next = () => {
    if (lines.length < 2) return;
    let n = at;
    while (n === at) n = Math.floor(Math.random() * lines.length);
    at = n;
    show(true);
  };
  fetch("splash-lines.json").then((r) => r.json()).then((all) => {
    lines = all;
    at = Math.floor(Math.random() * lines.length);
    show(false);
  }, () => {});
  langListeners.push(() => show(false));
  if (still) setInterval(next, 4000);
  else bar.addEventListener("animationiteration", next);

  const audio = new Audio();
  audio.preload = "none";
  audio.src = audio.canPlayType("audio/ogg; codecs=vorbis") ? "sound/start-chime.ogg" : "sound/start-chime.mp3";
  let armed = false;
  const ring = () => {
    armed = false;
    audio.currentTime = 0;
    audio.play().catch(() => {});
  };
  const arm = () => {
    audio.load();
    if (still) ring();
    else armed = true;
  };
  butter.addEventListener("animationiteration", () => { if (armed) ring(); });
  audio.addEventListener("play", () => chimeBtn?.setAttribute("aria-pressed", "true"));
  audio.addEventListener("ended", () => chimeBtn?.setAttribute("aria-pressed", "false"));
  document.getElementById("butter").addEventListener("click", arm);
  chimeBtn?.addEventListener("click", arm);
}
