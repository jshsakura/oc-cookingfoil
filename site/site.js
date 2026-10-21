// Language and theme, decided before paint and remembered between pages, plus the start screen on the home page.
(() => {
  const LANGS = { ko: "한국어", en: "English", ja: "日本語", zh: "中文" };
  const THEMES = ["light", "dark", "auto"];
  const root = document.documentElement;
  const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const write = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

  const documents = {
    en: { file: "README.md", setup: "quick-start", connect: "connecting-a-client", security: "security", report: "english" },
    ko: { file: "README.ko.md", setup: "빠른-시작", connect: "클라이언트-연결", security: "보안", report: "한국어" },
    ja: { file: "README.ja.md", setup: "クイックスタート", connect: "クライアントの接続", security: "セキュリティ", report: "日本語" },
    zh: { file: "README.zh-CN.md", setup: "快速开始", connect: "连接客户端", security: "安全", report: "简体中文" },
  };
  const syncLinks = () => {
    const locale = root.dataset.lang;
    const guide = documents[locale];
    for (const link of document.querySelectorAll("a[data-doc]")) {
      const section = guide[link.dataset.doc];
      const file = link.dataset.doc === "report" ? "SECURITY.md" : guide.file;
      link.href = `https://github.com/jshsakura/oc-cookingfoil/blob/main/${file}${section ? `#${section}` : ""}`;
    }
    for (const link of document.querySelectorAll('a[href="./"], a[href^="./?"], a[href^="privacy.html"], a[href^="terms.html"], a[data-site-page]')) {
      link.dataset.sitePage ??= link.getAttribute("href");
      const target = new URL(link.dataset.sitePage, location.href);
      target.searchParams.set("lang", locale);
      link.href = target.href;
    }
  };
  const langListeners = [syncLinks];
  const setLang = (l) => {
    root.dataset.lang = l;
    root.lang = l === "zh" ? "zh-Hans" : l;
    const address = new URL(location.href);
    address.searchParams.set("lang", l);
    history.replaceState(null, "", address);
    for (const f of langListeners) f(l);
  };
  const nav = (navigator.language || "").slice(0, 2).toLowerCase();
  const saved = read("lang");
  const requested = new URLSearchParams(location.search).get("lang");
  setLang(Object.hasOwn(LANGS, requested) ? requested : Object.hasOwn(LANGS, saved) ? saved : Object.hasOwn(LANGS, nav) ? nav : "en");
  if (Object.hasOwn(LANGS, requested)) write("lang", requested);

  const setTheme = (t) => { root.dataset.theme = t; };
  const savedTheme = read("theme");
  setTheme(THEMES.includes(savedTheme) ? savedTheme : "light");

  addEventListener("DOMContentLoaded", () => {
    syncLinks();
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
