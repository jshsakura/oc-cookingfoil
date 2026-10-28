/**
 * The six themes the console client offers (oc-cookingfoil-client include/ui/Theme.hpp, ids in
 * include/core/State.hpp ThemeNames), for the web page and the admin pages. Both surfaces build
 * their colour blocks, the head script that applies a stored choice before paint, and the picker in
 * the account menu from THEMES, so the list cannot differ between them.
 *
 * A theme is one palette in the web's vocabulary. Light and dark keep the web's own tuned values.
 * Navy, purple, green and pink take the client's colours and derive what the client has no colour
 * for (see fromClient). The choice is stored under "cookingfoil:theme"; with none stored the page
 * follows the system's light or dark.
 */

const BUTTER = "#ffc23d";
const ON_BUTTER = "#16161a";

const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const rgbToHex = (rgb) => `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
const mix = (a, b, t) => {
  const to = hexToRgb(b);
  return rgbToHex(hexToRgb(a).map((v, i) => Math.round(v + (to[i] - v) * t)));
};

function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio of two #rrggbb colours. */
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// A colour moved toward the page's ink in small steps until it reads at `min` on every ground.
function readable(color, grounds, ink, min) {
  for (let t = 0; t <= 1; t += 0.05) {
    const c = mix(color, ink, t);
    if (grounds.every((g) => contrast(c, g) >= min)) return c;
  }
  return ink;
}

const LIGHT = {
  scheme: "light",
  ground: "#f2f1ee", surface: "#ffffff", sunk: "#ebe9e4", line: "#e2e0da", line2: "#d3d0c8",
  ink: "#16161a", secondary: "#55555e", faint: "#8d8c93",
  good: "#1e8e5a", pending: "#c47c00", bad: "#cc3e34", dlc: "#4756c9", hero: "#16161a",
  modalBg: "#f2f1ee", modalPanel: "#ffffff", modalSunk: "#ebe9e4", modalLine: "#e2e0da",
  shadowRgb: "22, 22, 26", shadow: "rgba(22,22,26,.14)", warnCard: "#fde2e2",
};

const DARK = {
  scheme: "dark",
  ground: "#16161a", surface: "#1f1f24", sunk: "#26262c", line: "#303037", line2: "#41414a",
  ink: "#f2f1ee", secondary: "#a9a8a3", faint: "#75747c",
  good: "#3fbf83", pending: "#e3a43a", bad: "#ef6b5f", dlc: "#9aa7ff", hero: "#0c0c0e",
  modalBg: "#232329", modalPanel: "#2d2d34", modalSunk: "#35353d", modalLine: "#3e3e47",
  shadowRgb: "0, 0, 0", shadow: "rgba(0,0,0,.4)", warnCard: "#3a2424",
};

/**
 * The web palette from a client Palette (its ground, surface, ink, secondary, line, good, pending,
 * bad and redTint). The rest follows the way the tuned light and dark relate to their own colours:
 * - sunk sits halfway from the surface (dark) or the ground (light) to the line;
 * - line2 is the line 12% toward the ink, faint the secondary 35% toward the ground;
 * - the hero band is the ground 45% toward black on a dark page, the ink on a light one;
 * - a dialog on a dark page is each colour 7% toward the ink, so it stands off the page; on a light
 *   page it is the page's own colours;
 * - a warning card is the client's redTint.
 * Secondary text then reads at 4.5:1 or better and the faint, status and DLC colours at 3:1 on the
 * ground, the surface and sunk, moved toward the ink only as far as that takes.
 */
function fromClient(c) {
  const dark = c.scheme === "dark";
  const sunk = mix(dark ? c.surface : c.ground, c.line, 0.5);
  const grounds = [c.ground, c.surface, sunk];
  const atLeast = (color, min) => readable(color, grounds, c.ink, min);
  return {
    scheme: c.scheme,
    ground: c.ground, surface: c.surface, sunk, line: c.line, line2: mix(c.line, c.ink, 0.12),
    ink: c.ink, secondary: atLeast(c.secondary, 4.5), faint: atLeast(mix(c.secondary, c.ground, 0.35), 3),
    good: atLeast(c.good, 3), pending: atLeast(c.pending, 3), bad: atLeast(c.bad, 3),
    dlc: atLeast(dark ? DARK.dlc : LIGHT.dlc, 3),
    hero: dark ? mix(c.ground, "#000000", 0.45) : c.ink,
    modalBg: dark ? mix(c.ground, c.ink, 0.07) : c.ground,
    modalPanel: dark ? mix(c.surface, c.ink, 0.07) : c.surface,
    modalSunk: dark ? mix(sunk, c.ink, 0.07) : sunk,
    modalLine: dark ? mix(c.line, c.ink, 0.07) : c.line,
    shadowRgb: dark ? DARK.shadowRgb : hexToRgb(c.ink).join(", "),
    shadow: dark ? DARK.shadow : `rgba(${hexToRgb(c.ink).join(",")},.14)`,
    warnCard: c.redTint,
  };
}

// Navy is Nord, purple Catppuccin Mocha, green Everforest, pink the client's own light page.
export const THEMES = [
  { id: "light", ...LIGHT },
  { id: "dark", ...DARK },
  { id: "navy", ...fromClient({ scheme: "dark", ground: "#2e3440", surface: "#3e4658", ink: "#eceff4", secondary: "#c4ccda", line: "#4c566a", good: "#a3be8c", pending: "#ebcb8b", bad: "#e28088", redTint: "#523f4a" }) },
  { id: "purple", ...fromClient({ scheme: "dark", ground: "#1e1e2e", surface: "#313244", ink: "#cdd6f4", secondary: "#a6adc8", line: "#45475a", good: "#a6e3a1", pending: "#fab387", bad: "#f38ba8", redTint: "#53394d" }) },
  { id: "green", ...fromClient({ scheme: "dark", ground: "#2d353b", surface: "#3c484f", ink: "#d3c6aa", secondary: "#a5afa0", line: "#4c585e", good: "#a7c080", pending: "#dbbc7f", bad: "#ec8688", redTint: "#5b474c" }) },
  { id: "pink", ...fromClient({ scheme: "light", ground: "#f9e7ec", surface: "#fff7f9", ink: "#4a3442", secondary: "#745a68", line: "#eed2dc", good: "#1e8e5a", pending: "#b06e00", bad: "#c43048", redTint: "#fcd6de" }) },
];

const byId = Object.fromEntries(THEMES.map((t) => [t.id, t]));
const rgb = (hex) => hexToRgb(hex).join(", ");

/** The admin pages' tokens (src/routes/admin/styles.js) for one theme. */
export const adminVars = (t) => `--bg:${t.ground};--panel:${t.surface};--sunk:${t.sunk};--line:${t.line};--line2:${t.line2};
--text:${t.ink};--muted:${t.secondary};--faint:${t.faint};--warn:${t.pending};--bad:${t.bad};--good:${t.good};--accent:${BUTTER};--accent-ink:${ON_BUTTER};
--warn-rgb:${rgb(t.pending)};--bad-rgb:${rgb(t.bad)};--good-rgb:${rgb(t.good)};--accent-rgb:${rgb(BUTTER)};--shadow:${t.shadow};--warn-card:${t.warnCard};color-scheme:${t.scheme}`;

/** The web page's tokens (src/views/landing.html) for one theme. */
export const siteVars = (t) => `--ground: ${t.ground}; --surface: ${t.surface}; --sunk: ${t.sunk}; --ink: ${t.ink};
        --line: ${t.line}; --line2: ${t.line2}; --secondary: ${t.secondary}; --faint: ${t.faint};
        --butter: ${BUTTER}; --butter-ink: ${ON_BUTTER}; --hero: ${t.hero};
        --modal-bg: ${t.modalBg}; --modal-panel: ${t.modalPanel}; --modal-sunk: ${t.modalSunk}; --modal-line: ${t.modalLine};
        --good: ${t.good}; --pending: ${t.pending}; --bad: ${t.bad};
        --dlc: ${t.dlc}; --dlc-rgb: ${rgb(t.dlc)};
        --butter-rgb: ${rgb(BUTTER)}; --good-rgb: ${rgb(t.good)}; --bad-rgb: ${rgb(t.bad)}; --shadow-rgb: ${t.shadowRgb};
        color-scheme: ${t.scheme}`;

/** Dark by default, light when the system asks and nothing is chosen, then one block per theme. */
export function themeCss(vars) {
  return [
    `:root{${vars(byId.dark)}}`,
    `@media (prefers-color-scheme:light){:root:not([data-theme]){${vars(byId.light)}}}`,
    ...THEMES.map((t) => `:root[data-theme="${t.id}"]{${vars(t)}}`),
  ].join("\n");
}

const BAR = Object.fromEntries(THEMES.map((t) => [t.id, t.ground]));

/**
 * Applies the stored theme before paint and keeps the address-bar colour on the theme in use.
 * Both surfaces carry it in the head, after the theme-color meta.
 */
export const THEME_HEAD_SCRIPT = `(()=>{const r=document.documentElement,q=matchMedia("(prefers-color-scheme: light)"),m=document.querySelector('meta[name="theme-color"]'),c=${JSON.stringify(BAR)},k=(t)=>Object.hasOwn(c,t);try{const t=localStorage.getItem("cookingfoil:theme");if(k(t))r.dataset.theme=t;}catch{}const s=()=>{if(m)m.content=c[k(r.dataset.theme)?r.dataset.theme:q.matches?"light":"dark"];};s();q.addEventListener("change",s);new MutationObserver(s).observe(r,{attributes:true,attributeFilter:["data-theme"]});})();`;

/**
 * The picker in the account menu: a labelled group of six radio items in one row, each a swatch of
 * the theme's ground and surface with its name kept for screen readers. `word(key)` gives the markup for a label (the page's i18n span).
 */
export const themePickerHtml = (word) => `<div class="theme-pick" role="group" aria-labelledby="theme-pick-label">
<span class="theme-pick-label" id="theme-pick-label">${word("theme.label")}</span>
<div class="theme-pick-grid">${THEMES.map((t) => `<button type="button" role="menuitemradio" aria-checked="false" data-theme-pick="${t.id}"><span class="theme-swatch" aria-hidden="true"></span><span class="theme-name">${word(`theme.${t.id}`)}</span></button>`).join("")}</div>
</div>`;

// Read inside the account menu on both surfaces, so it uses the admin token names the web page's
// menu maps onto its own (.activity-account in landing.html).
export const THEME_PICKER_CSS = `
.theme-pick{display:grid;gap:6px;padding:6px 6px 4px}
.theme-pick-label{font-size:var(--fs-xs);font-weight:var(--fw-bold);color:var(--muted);padding:0 6px}
.theme-pick-grid{display:flex;flex-wrap:wrap;justify-content:flex-start;align-items:center;gap:2px;padding:2px 4px}
.pop-list .theme-pick [data-theme-pick]{display:grid;place-items:center;position:relative;flex:none;width:36px;height:36px;padding:0;border:0;border-radius:50%;background:transparent;cursor:pointer}
.pop-list .theme-pick [data-theme-pick]:hover .theme-swatch{transform:scale(1.12)}
.pop-list .theme-pick [data-theme-pick]:focus-visible{outline:2px solid var(--accent);outline-offset:0}
.theme-pick [aria-checked="true"] .theme-swatch{box-shadow:0 0 0 2px var(--panel),0 0 0 4px var(--accent)}
.theme-swatch{width:22px;height:22px;border-radius:50%;box-shadow:inset 0 0 0 1px rgba(127,127,127,.45);transition:transform .12s,box-shadow .12s}
.theme-name{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
${THEMES.map((t) => `[data-theme-pick="${t.id}"] .theme-swatch{background:linear-gradient(135deg,${t.ground} 0 50%,${t.surface} 50% 100%)}`).join("\n")}
`;

/**
 * Wires the picker: a choice is applied and stored, the arrow keys move between the six, and the
 * page hears "cookingfoil:theme" to redraw what it paints per theme.
 */
export const THEME_PICKER_SCRIPT = `{
const themeSystemLight=matchMedia('(prefers-color-scheme: light)');
const themeItems=[...document.querySelectorAll('[data-theme-pick]')];
const themeNow=()=>document.documentElement.dataset.theme||(themeSystemLight.matches?'light':'dark');
const syncThemePicker=()=>{const now=themeNow();for(const b of themeItems)b.setAttribute('aria-checked',String(b.dataset.themePick===now));};
for(const [i,b] of themeItems.entries()){
  b.addEventListener('click',()=>{const id=b.dataset.themePick;document.documentElement.dataset.theme=id;
    try{localStorage.setItem('cookingfoil:theme',id);}catch{/* storage blocked: this visit only */}
    syncThemePicker();document.dispatchEvent(new Event('cookingfoil:theme'));});
  b.addEventListener('keydown',(e)=>{const step={ArrowRight:1,ArrowDown:1,ArrowLeft:-1,ArrowUp:-1}[e.key];if(!step)return;
    e.preventDefault();themeItems[(i+step+themeItems.length)%themeItems.length].focus();});
}
themeSystemLight.addEventListener('change',()=>{syncThemePicker();document.dispatchEvent(new Event('cookingfoil:theme'));});
syncThemePicker();
}`;

/** The picker's words, in the twelve languages the console client names its themes in. */
export const THEME_WORDS = {
  ko: { "theme.label": "테마", "theme.light": "베이지", "theme.dark": "블랙", "theme.navy": "네이비", "theme.purple": "퍼플", "theme.green": "그린", "theme.pink": "핑크" },
  en: { "theme.label": "Theme", "theme.light": "Beige", "theme.dark": "Black", "theme.navy": "Navy", "theme.purple": "Purple", "theme.green": "Green", "theme.pink": "Pink" },
  ja: { "theme.label": "テーマ", "theme.light": "ベージュ", "theme.dark": "ブラック", "theme.navy": "ネイビー", "theme.purple": "パープル", "theme.green": "グリーン", "theme.pink": "ピンク" },
  zh: { "theme.label": "主题", "theme.light": "米色", "theme.dark": "纯黑", "theme.navy": "藏青", "theme.purple": "紫色", "theme.green": "绿色", "theme.pink": "粉色" },
  "zh-Hant": { "theme.label": "主題", "theme.light": "米色", "theme.dark": "純黑", "theme.navy": "藏青", "theme.purple": "紫色", "theme.green": "綠色", "theme.pink": "粉色" },
  es: { "theme.label": "Tema", "theme.light": "Beige", "theme.dark": "Negro", "theme.navy": "Azul marino", "theme.purple": "Morado", "theme.green": "Verde", "theme.pink": "Rosa" },
  fr: { "theme.label": "Thème", "theme.light": "Beige", "theme.dark": "Noir", "theme.navy": "Marine", "theme.purple": "Violet", "theme.green": "Vert", "theme.pink": "Rose" },
  de: { "theme.label": "Design", "theme.light": "Beige", "theme.dark": "Schwarz", "theme.navy": "Marineblau", "theme.purple": "Lila", "theme.green": "Grün", "theme.pink": "Rosa" },
  it: { "theme.label": "Tema", "theme.light": "Beige", "theme.dark": "Nero", "theme.navy": "Blu navy", "theme.purple": "Viola", "theme.green": "Verde", "theme.pink": "Rosa" },
  pt: { "theme.label": "Tema", "theme.light": "Bege", "theme.dark": "Preto", "theme.navy": "Azul-marinho", "theme.purple": "Roxo", "theme.green": "Verde", "theme.pink": "Rosa" },
  nl: { "theme.label": "Thema", "theme.light": "Beige", "theme.dark": "Zwart", "theme.navy": "Marineblauw", "theme.purple": "Paars", "theme.green": "Groen", "theme.pink": "Roze" },
  ru: { "theme.label": "Тема", "theme.light": "Бежевая", "theme.dark": "Чёрная", "theme.navy": "Тёмно-синяя", "theme.purple": "Фиолетовая", "theme.green": "Зелёная", "theme.pink": "Розовая" },
};
