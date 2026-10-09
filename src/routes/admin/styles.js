/**
 * Shared chrome for every /admin page: Catppuccin Mocha (dark) and Latte
 * (light), the same palettes as the public dashboard. ADMIN_HEAD adds the icon
 * and applies the theme the visitor chose there (same origin, same storage key)
 * before paint.
 */
export const ADMIN_HEAD = /* html */ `<link rel="icon" href="/assets/cookingfoil.svg" type="image/svg+xml">\
<script>try{const t=localStorage.getItem("cookingfoil:theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t;}catch{}</script>`;

const DARK = `--bg:#1e1e2e;--panel:#181825;--sunk:#11111b;--line:#313244;--line2:#45475a;
--text:#cdd6f4;--muted:#a6adc8;--faint:#6c7086;--warn:#f9e2af;--bad:#f38ba8;--good:#a6e3a1;--accent:#f9e2af;
--warn-rgb:249,226,175;--bad-rgb:243,139,168;--good-rgb:166,227,161;--accent-rgb:249,226,175;--shadow:rgba(0,0,0,.4);color-scheme:dark`;
const LIGHT = `--bg:#eff1f5;--panel:#ffffff;--sunk:#e6e9ef;--line:#dce0e8;--line2:#bcc0cc;
--text:#4c4f69;--muted:#6c6f85;--faint:#9ca0b0;--warn:#df8e1d;--bad:#d20f39;--good:#40a02b;--accent:#df8e1d;
--warn-rgb:223,142,29;--bad-rgb:210,15,57;--good-rgb:64,160,43;--accent-rgb:223,142,29;--shadow:rgba(76,79,105,.18);color-scheme:light`;

export const ADMIN_CSS = /* css */ `
:root{${DARK}}
@media (prefers-color-scheme:light){:root:not([data-theme="dark"]){${LIGHT}}}
:root[data-theme="light"]{${LIGHT}}
*{box-sizing:border-box}
body{margin:0;font:14px/1.5 "Inter","Noto Sans KR",system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--bg);color:var(--text);word-break:keep-all}
.muted{color:var(--muted);font-size:13px}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
h2{font-size:15px;margin:26px 0 10px}
table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden}
th,td{text-align:left;padding:10px 12px;font-size:13px;border-bottom:1px solid var(--line);vertical-align:middle}
th{color:var(--muted);font-weight:600;background:var(--sunk);white-space:nowrap}
tr:last-child td{border-bottom:none}
.pill{display:inline-block;padding:2px 9px;border-radius:100px;font-size:12px;background:var(--line);color:var(--text);white-space:nowrap}
.pill.on{background:rgba(var(--good-rgb),.16);color:var(--good)}
.pill.off{background:rgba(var(--bad-rgb),.14);color:var(--bad)}
.pill.warn{background:rgba(var(--warn-rgb),.16);color:var(--warn)}
.ip{color:var(--muted);font-size:12px;font-family:ui-monospace,monospace;word-break:break-all}
button,.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:8px 14px;border:1px solid var(--line2);
border-radius:9px;cursor:pointer;background:transparent;color:var(--text);font:inherit;font-size:13px;text-decoration:none}
button:hover,.btn:hover{background:var(--line)}
button:disabled{opacity:.5;cursor:default}
button.primary{border-color:transparent;background:var(--accent);color:var(--sunk);font-weight:700}
button.primary:hover{filter:brightness(1.05);background:var(--accent)}
button.danger{color:var(--bad);border-color:rgba(var(--bad-rgb),.4)}
input,select{padding:9px 12px;border-radius:9px;border:1px solid var(--line2);background:var(--sunk);color:var(--text);font:inherit;font-size:14px}
input:focus,select:focus,button:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.empty{color:var(--faint);padding:16px;text-align:center;background:var(--panel);border:1px solid var(--line);border-radius:12px}
.note{border-radius:12px;padding:14px 16px;margin-bottom:12px;border:1px solid var(--line);background:var(--panel)}
.note.warn{border-color:rgba(var(--warn-rgb),.45);background:rgba(var(--warn-rgb),.08)}
.note .t{font-weight:700;margin-bottom:4px}
.note .d{color:var(--muted);font-size:13px}
`;
