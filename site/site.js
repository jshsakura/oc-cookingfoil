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

// A successful chime is kept for this tab's visit, even after a reload. The
// in-memory guard also covers browsers that refuse session storage.
function startSplash(langListeners) {
  const stage = document.getElementById("butter");
  const butter = stage?.querySelector(".butter");
  if (!butter) return;
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const labels = {
    ko: ["시작 소리 듣기", "시작 소리를 재생했습니다"],
    en: ["Play the start chime", "Start chime played"],
    ja: ["起動音を聴く", "起動音を再生しました"],
    zh: ["播放启动音", "启动音已播放"],
  };
  const seen = () => { try { return sessionStorage.getItem("chimed") === "1"; } catch { return false; } };
  const mark = () => { try { sessionStorage.setItem("chimed", "1"); } catch { /* The memory guard still prevents another play. */ } };
  let played = seen();
  let pending = false;
  let armed = !played;
  const sync = () => {
    const names = labels[document.documentElement.dataset.lang] ?? labels.en;
    stage.disabled = played;
    stage.setAttribute("aria-label", names[played ? 1 : 0]);
    stage.title = names[played ? 1 : 0];
  };
  langListeners.push(sync);
  sync();
  if (played) return;

  const audio = new Audio();
  audio.preload = "auto";
  audio.src = audio.canPlayType("audio/ogg; codecs=vorbis") ? "sound/start-chime.ogg" : "sound/start-chime.mp3";
  const gestures = ["pointerdown", "keydown", "touchstart"];
  const clearGestures = () => { for (const event of gestures) removeEventListener(event, onGesture, true); };
  const onGesture = () => { clearGestures(); ring(); };
  const ring = () => {
    if (played || pending) return;
    armed = false;
    pending = true;
    audio.play().then(() => {
      pending = false;
      played = true;
      mark();
      clearGestures();
      sync();
    }, (error) => {
      pending = false;
      if (error?.name === "NotAllowedError") {
        for (const event of gestures) addEventListener(event, onGesture, { capture: true, once: true });
      }
    });
  };
  if (still) ring();
  butter.addEventListener("animationiteration", () => { if (armed) ring(); });
  stage.addEventListener("click", ring);
}
