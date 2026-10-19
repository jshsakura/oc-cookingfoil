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
const LIGHT = `--bg:#f2f1ee;--panel:#ffffff;--sunk:#ebe9e4;--line:#e2e0da;--line2:#d3d0c8;
--text:#16161a;--muted:#55555e;--faint:#8d8c93;--warn:#c47c00;--bad:#cc3e34;--good:#1e8e5a;--accent:#ffc23d;--accent-ink:#16161a;
--warn-rgb:196,124,0;--bad-rgb:204,62,52;--good-rgb:30,142,90;--accent-rgb:255,194,61;--shadow:rgba(22,22,26,.14);color-scheme:light`;

export const ADMIN_CSS = /* css */ `
:root{${DARK}}
@media (prefers-color-scheme:light){:root:not([data-theme="dark"]){${LIGHT}}}
:root[data-theme="light"]{${LIGHT}}
*{box-sizing:border-box}
body{margin:0;font:14px/1.55 "Inter","Noto Sans KR",system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--bg);color:var(--text);word-break:keep-all;-webkit-font-smoothing:antialiased}
.muted{color:var(--muted);font-size:13px}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
h2{font-size:18px;font-weight:800;margin:28px 0 12px}
table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--line);border-radius:16px;overflow:hidden}
th,td{text-align:left;padding:12px 14px;font-size:13px;border-bottom:1px solid var(--line);vertical-align:middle}
th{color:var(--muted);font-weight:600;background:var(--panel);white-space:nowrap}
tr:last-child td{border-bottom:none}
.pill{display:inline-block;padding:3px 10px;border-radius:100px;font-size:12px;font-weight:600;background:var(--sunk);color:var(--text);white-space:nowrap}
.pill.on{background:rgba(var(--good-rgb),.14);color:var(--good)}
.pill.off{background:rgba(var(--bad-rgb),.12);color:var(--bad)}
.pill.warn{background:rgba(var(--accent-rgb),.22);color:var(--warn)}
.ip{color:var(--muted);font-size:12px;font-family:ui-monospace,monospace;word-break:break-all}
button,.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:9px 16px;border:1px solid var(--line);
border-radius:12px;cursor:pointer;background:var(--panel);color:var(--text);font:inherit;font-size:13px;font-weight:600;text-decoration:none}
button:hover,.btn:hover{border-color:var(--text)}
button:disabled{opacity:.5;cursor:default}
button.primary{border-color:transparent;background:var(--accent);color:var(--accent-ink);font-weight:700}
button.primary:hover{filter:brightness(1.04);border-color:transparent}
button.danger{color:var(--bad);border-color:rgba(var(--bad-rgb),.4)}
input:not([type=checkbox]):not([type=radio]),select{padding:10px 14px;border-radius:12px;border:1px solid transparent;background:var(--sunk);color:var(--text);font:inherit;font-size:14px}
/* Our own arrow with room on the right, instead of the browser's pressed against the edge. */
select{appearance:none;-webkit-appearance:none;padding-right:38px;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1.5l5 5 5-5' fill='none' stroke='%238b909a' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 14px center;background-size:12px 8px;text-overflow:ellipsis}
input:not([type=checkbox]):not([type=radio]):focus,select:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px rgba(var(--accent-rgb),.3)}
/* One checkbox everywhere: a quiet box that fills with the accent and a check when on. */
:where(input[type=checkbox]){appearance:none;-webkit-appearance:none;flex:none;width:18px;height:18px;margin:0;padding:0;border-radius:5px;border:1.5px solid var(--line2,var(--line));background:var(--panel);cursor:pointer;display:inline-grid;place-content:center;vertical-align:middle;transition:background .12s,border-color .12s}
:where(input[type=checkbox])::after{content:"";width:10px;height:6px;border:2px solid var(--bg);border-top:0;border-right:0;transform:translateY(-1px) rotate(-45deg) scale(0);transition:transform .12s}
:where(input[type=checkbox]):checked{background:var(--accent);border-color:var(--accent)}
:where(input[type=checkbox]):checked::after{transform:translateY(-1px) rotate(-45deg) scale(1)}
:where(input[type=checkbox]):hover:not(:disabled){border-color:var(--accent)}
:where(input[type=checkbox]):focus-visible{outline:none;box-shadow:0 0 0 3px rgba(var(--accent-rgb),.3)}
:where(input[type=checkbox]):disabled{opacity:.45;cursor:default}
button:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.empty{color:var(--faint);padding:20px;text-align:center;background:var(--panel);border:1px dashed var(--line2);border-radius:16px;margin-bottom:20px}
.note{border-radius:16px;padding:16px 18px;margin-bottom:12px;border:1px solid var(--line);background:var(--panel)}
.note.warn{border-color:rgba(var(--accent-rgb),.7);background:rgba(var(--accent-rgb),.12)}
.note .t{font-weight:700;margin-bottom:4px}
.note .d{color:var(--muted);font-size:13px}
`;
