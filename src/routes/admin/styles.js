/**
 * Shared chrome for every /admin page, in the client app's palette (warm
 * ground, white surfaces, ink text, butter accent) and the public dashboard's
 * dark variant. ADMIN_HEAD adds the icon and applies the theme picked in the
 * account menu (here or on the web page: same origin, same storage key) before
 * paint; no choice follows the system. THEME_HEAD_SCRIPT is the same script the
 * web page carries, and it keeps the address-bar colour on the theme in use.
 */
export const THEME_HEAD_SCRIPT = `(()=>{const r=document.documentElement,q=matchMedia("(prefers-color-scheme: light)"),m=document.querySelector('meta[name="theme-color"]');try{const t=localStorage.getItem("cookingfoil:theme");if(t==="light"||t==="dark")r.dataset.theme=t;}catch{}const s=()=>{if(m)m.content=(r.dataset.theme||(q.matches?"light":"dark"))==="light"?"#f2f1ee":"#16161a";};s();q.addEventListener("change",s);new MutationObserver(s).observe(r,{attributes:true,attributeFilter:["data-theme"]});})();`;

export const ADMIN_HEAD = /* html */ `<link rel="icon" href="/assets/cookingfoil.svg" type="image/svg+xml">\
<link rel="stylesheet" href="/assets/fonts.css">\
<meta name="theme-color" content="#16161a">\
<script>${THEME_HEAD_SCRIPT}</script>`;

const DARK = `--bg:#16161a;--panel:#1f1f24;--sunk:#26262c;--line:#303037;--line2:#41414a;
--text:#f2f1ee;--muted:#a9a8a3;--faint:#75747c;--warn:#e3a43a;--bad:#ef6b5f;--good:#3fbf83;--accent:#ffc23d;--accent-ink:#16161a;
--warn-rgb:227,164,58;--bad-rgb:239,107,95;--good-rgb:63,191,131;--accent-rgb:255,194,61;--shadow:rgba(0,0,0,.4);color-scheme:dark`;
export const LIGHT = `--bg:#f2f1ee;--panel:#ffffff;--sunk:#ebe9e4;--line:#e2e0da;--line2:#d3d0c8;
--text:#16161a;--muted:#55555e;--faint:#8d8c93;--warn:#c47c00;--bad:#cc3e34;--good:#1e8e5a;--accent:#ffc23d;--accent-ink:#16161a;
--warn-rgb:196,124,0;--bad-rgb:204,62,52;--good-rgb:30,142,90;--accent-rgb:255,194,61;--shadow:rgba(22,22,26,.14);color-scheme:light`;

// The client's scale (~/app/cookingfoil-ops/design/client-design-tokens.md) at web size: radii
// badge 5, chip 7, row 10-12, button 14, group card 18, dialog 20 on a 1280x720 screen read from
// the couch, drawn here a step smaller; Regular and Bold only. Panels use these, never raw px or hex
// (scripts/design-scan.mjs counts what is left).
export const SCALE = `--r-xs:4px;--r-sm:6px;--r-md:10px;--r-lg:12px;--r-xl:14px;--r-2xl:16px;--r-pill:999px;
--fs-2xs:11px;--fs-xs:12px;--fs-sm:13px;--fs-md:14px;--fs-lg:16px;--fs-xl:18px;--fs-2xl:22px;--fs-3xl:28px;
--fw:400;--fw-bold:700;
--white:#ffffff;--ground:#f2f1ee;--medal-1:#f5c542;--medal-1-ink:#3d2e00;--medal-2:#cfd3d9;--medal-2-ink:#2a2e35;--medal-3:#d9a574;--medal-3-ink:#3b2410`;

export const ADMIN_CSS = /* css */ `
:root{${SCALE};${DARK}}
@media (prefers-color-scheme:light){:root:not([data-theme="dark"]){${LIGHT}}}
:root[data-theme="light"]{${LIGHT}}
/* One scrollbar for every admin page, in the page's own colours and both themes.
   The scope is the admin document root itself (html.adm) so the viewport scroll is
   covered too, and the user dashboard (landing.html) keeps its own rules untouched.
   forced-colors and OS-level overlay scrollbars are left to the system. */
html.adm{scrollbar-width:thin;scrollbar-color:var(--line2) transparent}
html.adm::-webkit-scrollbar,html.adm ::-webkit-scrollbar{width:10px;height:10px}
html.adm::-webkit-scrollbar-track,html.adm ::-webkit-scrollbar-track{background:transparent}
html.adm::-webkit-scrollbar-thumb,html.adm ::-webkit-scrollbar-thumb{background:var(--line2);border-radius:var(--r-sm);border:2px solid transparent;background-clip:padding-box}
html.adm::-webkit-scrollbar-thumb:hover,html.adm ::-webkit-scrollbar-thumb:hover{background-color:var(--faint)}
html.adm::-webkit-scrollbar-corner,html.adm ::-webkit-scrollbar-corner{background:transparent}
@supports not selector(::-webkit-scrollbar){html.adm *{scrollbar-width:thin;scrollbar-color:var(--line2) transparent}}
@media (forced-colors:active){html.adm{scrollbar-color:auto}}
/* A row that hides its scrollbar on purpose says so with this class. */
.hide-bar{scrollbar-width:none}.hide-bar::-webkit-scrollbar{display:none}
*{box-sizing:border-box}
body{margin:0;font:14px/1.55 "Inter","Noto Sans KR",system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--bg);color:var(--text);word-break:keep-all;-webkit-font-smoothing:antialiased}
.muted{color:var(--muted);font-size:var(--fs-sm)}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
h2{font-size:var(--fs-xl);font-weight:var(--fw-bold);margin:28px 0 12px}
table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--line);border-radius:var(--r-2xl);overflow:hidden}
th,td{text-align:left;padding:12px 14px;font-size:var(--fs-sm);border-bottom:1px solid var(--line);vertical-align:middle}
th{color:var(--muted);font-weight:var(--fw-bold);background:var(--panel);white-space:nowrap}
tr:last-child td{border-bottom:none}
.pill{display:inline-block;padding:3px 8px;border-radius:var(--r-sm);font-size:var(--fs-xs);font-weight:var(--fw-bold);background:var(--sunk);color:var(--text);white-space:nowrap}
.pill.on{background:rgba(var(--good-rgb),.14);color:var(--good)}
.pill.off{background:rgba(var(--bad-rgb),.12);color:var(--bad)}
.pill.warn{background:rgba(var(--accent-rgb),.22);color:var(--warn)}
.ip{color:var(--muted);font-size:var(--fs-xs);font-family:ui-monospace,monospace;word-break:break-all}
button,.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:9px 16px;border:1px solid var(--line);
border-radius:var(--r-lg);cursor:pointer;background:var(--panel);color:var(--text);font:inherit;font-size:var(--fs-sm);font-weight:var(--fw-bold);text-decoration:none}
button:hover,.btn:hover{border-color:var(--text)}
button:disabled{opacity:.5;cursor:default}
button.primary{border-color:transparent;background:var(--accent);color:var(--accent-ink);font-weight:700}
button.primary:hover{filter:brightness(1.04);border-color:transparent}
button.danger{color:var(--bad);border-color:rgba(var(--bad-rgb),.4)}
input:not([type=checkbox]):not([type=radio]),select{padding:10px 14px;border-radius:var(--r-lg);border:1px solid transparent;background:var(--sunk);color:var(--text);font:inherit;font-size:var(--fs-md)}
/* Our own arrow with room on the right, instead of the browser's pressed against the edge. */
select{appearance:none;-webkit-appearance:none;padding-right:38px;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1.5l5 5 5-5' fill='none' stroke='%238b909a' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 14px center;background-size:12px 8px;text-overflow:ellipsis}
input:not([type=checkbox]):not([type=radio]):focus,select:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px rgba(var(--accent-rgb),.3)}
/* One checkbox everywhere: a quiet box that fills with the accent and a check when on. */
:where(input[type=checkbox]){appearance:none;-webkit-appearance:none;flex:none;width:18px;height:18px;margin:0;padding:0;border-radius:var(--r-xs);border:1.5px solid var(--line2,var(--line));background:var(--panel);cursor:pointer;display:inline-grid;place-content:center;vertical-align:middle;transition:background .12s,border-color .12s}
:where(input[type=checkbox])::after{content:"";width:10px;height:6px;border:2px solid var(--bg);border-top:0;border-right:0;transform:translateY(-1px) rotate(-45deg) scale(0);transition:transform .12s}
:where(input[type=checkbox]):checked{background:var(--accent);border-color:var(--accent)}
:where(input[type=checkbox]):checked::after{transform:translateY(-1px) rotate(-45deg) scale(1)}
:where(input[type=checkbox]):hover:not(:disabled){border-color:var(--accent)}
:where(input[type=checkbox]):focus-visible{outline:none;box-shadow:0 0 0 3px rgba(var(--accent-rgb),.3)}
:where(input[type=checkbox]):disabled{opacity:.45;cursor:default}
button:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
/* The client's toggle (52x30 pill, a white knob, green when on) at web size. Two markups share it: a
   button[role=switch or menuitemcheckbox][aria-checked] holding span.switch, and label.ss-switch holding
   a checkbox and a span. */
.switch,.ss-switch>span{position:relative;display:inline-block;flex:none;width:40px;height:24px;border-radius:var(--r-pill);background:var(--line2);transition:background .15s}
.switch::after,.ss-switch>span::after{content:"";position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:var(--white);box-shadow:0 1px 3px rgba(0,0,0,.25);transition:transform .15s}
[aria-checked="true"]>.switch,.ss-switch>input:checked+span{background:var(--good)}
[aria-checked="true"]>.switch::after,.ss-switch>input:checked+span::after{transform:translateX(16px)}
.ss-switch{position:relative;display:inline-block;vertical-align:middle;width:40px;height:24px;flex:none}
.ss-switch>input{position:absolute;inset:0;z-index:1;width:100%;height:100%;opacity:0;margin:0;cursor:pointer}
.ss-switch>input:disabled{cursor:default}.ss-switch>input:disabled+span{opacity:.5}
.ss-switch>input:focus-visible+span,[role=switch]:focus-visible>.switch,[role=menuitemcheckbox]:focus-visible>.switch{outline:3px solid var(--accent);outline-offset:2px}
.menu-toggle .switch{margin-left:auto}
@media (prefers-reduced-motion:reduce){.switch,.switch::after,.ss-switch>span,.ss-switch>span::after{transition:none}}
/* The client's empty state: a plain white card, its text in the secondary colour. */
.empty{color:var(--muted);padding:24px 20px;text-align:center;background:var(--panel);border:1px solid var(--line);border-radius:var(--r-2xl);margin-bottom:20px}
/* The client's dialog foot: the buttons on a ground-coloured band under a line, to the dialog's edges. */
dialog>.dialog-actions:last-child{margin:16px calc(-1 * var(--dlg-pad,24px)) calc(-1 * var(--dlg-pad,24px));padding:14px var(--dlg-pad,24px);background:var(--bg);border-top:1px solid var(--line);border-radius:0 0 var(--r-2xl) var(--r-2xl)}
/* A note with a title reads like a box: the title on its own band, so it never sinks into the page. */
.note{border-radius:var(--r-2xl);padding:16px 18px;margin-bottom:12px;border:1px solid var(--line);background:var(--panel)}
.note.warn{border-color:rgba(var(--accent-rgb),.7);background:rgba(var(--accent-rgb),.12)}
.note:has(>.t){padding:0;overflow:hidden;background:var(--panel)}
.note>.t{font-weight:700;padding:13px 18px;background:var(--sunk);border-bottom:1px solid var(--line)}
.note.warn>.t{background:rgba(var(--accent-rgb),.16);border-bottom-color:rgba(var(--accent-rgb),.45)}
.note>.d{color:var(--muted);font-size:var(--fs-sm);padding:12px 18px 14px}
.note:has(>.t)>:not(.t):not(.d){margin:0 18px 16px}
`;
