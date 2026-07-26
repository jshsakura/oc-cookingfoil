/** Shared Catppuccin-Mocha chrome for every /admin page. */
export const ADMIN_CSS = /* css */ `
:root{color-scheme:dark;--bg:#1e1e2e;--panel:#181825;--sunk:#11111b;--line:#313244;
--text:#cdd6f4;--muted:#a6adc8;--faint:#6c7086;--warn:#f9e2af;--bad:#f38ba8;--good:#a6e3a1;--accent:#fab387}
*{box-sizing:border-box}
body{margin:0;font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--bg);color:var(--text)}
.muted{color:var(--muted);font-size:13px}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
h2{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:26px 0 10px}
table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--line);
border-radius:12px;overflow:hidden}
th,td{text-align:left;padding:10px 12px;font-size:13px;border-bottom:1px solid #262637;vertical-align:top}
th{color:var(--muted);font-weight:600;background:var(--sunk);white-space:nowrap}
tr:last-child td{border-bottom:none}
.pill{display:inline-block;padding:2px 8px;border-radius:100px;font-size:11px;background:var(--line);color:var(--text);white-space:nowrap}
.pill.on{background:rgba(166,227,161,.18);color:var(--good)}
.pill.off{background:rgba(243,139,168,.16);color:var(--bad)}
.pill.warn{background:rgba(249,226,175,.16);color:var(--warn)}
.ip{color:var(--muted);font-size:12px;font-family:ui-monospace,monospace;word-break:break-all}
button{padding:8px 14px;border:1px solid #45475a;border-radius:9px;cursor:pointer;background:transparent;
color:var(--text);font:inherit;font-size:13px}
button:hover{background:var(--line)}
button.primary{border:none;background:linear-gradient(135deg,var(--accent),#b4befe);color:var(--sunk);font-weight:700}
.empty{color:var(--faint);padding:14px;text-align:center;background:var(--panel);
border:1px solid var(--line);border-radius:12px}
.note{border-radius:12px;padding:14px 16px;margin-bottom:12px;border:1px solid var(--line);background:var(--panel)}
.note.warn{border-color:rgba(249,226,175,.4);background:rgba(249,226,175,.08)}
.note .t{font-weight:700;margin-bottom:4px}
.note .d{color:var(--muted);font-size:13px}
`;
