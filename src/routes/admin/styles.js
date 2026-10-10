/**
 * Shared chrome for every /admin page, in the Switch client's palette (warm
 * ground, white surfaces, ink text, butter accent) and the public dashboard's
 * dark variant. ADMIN_HEAD adds the icon and applies the theme the visitor
 * chose there (same origin, same storage key) before paint.
 */
export const ADMIN_HEAD = /* html */ `<link rel="icon" href="/assets/cookingfoil.svg" type="image/svg+xml">\
<script>try{const t=localStorage.getItem("cookingfoil:theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t;}catch{}</script>`;

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
input,select{padding:10px 14px;border-radius:12px;border:1px solid transparent;background:var(--sunk);color:var(--text);font:inherit;font-size:14px}
input:focus,select:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px rgba(var(--accent-rgb),.3)}
button:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.empty{color:var(--faint);padding:20px;text-align:center;background:var(--panel);border:1px dashed var(--line2);border-radius:16px}
.note{border-radius:16px;padding:16px 18px;margin-bottom:12px;border:1px solid var(--line);background:var(--panel)}
.note.warn{border-color:rgba(var(--accent-rgb),.7);background:rgba(var(--accent-rgb),.12)}
.note .t{font-weight:700;margin-bottom:4px}
.note .d{color:var(--muted);font-size:13px}
`;
