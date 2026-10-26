/**
 * The operator guide as a page for people. The same text is served raw at
 * /admin/guide.md for an AI helper working with an automation token.
 */
import { ADMIN_CSS, ADMIN_HEAD } from "./styles.js";
import { renderMarkdown } from "../../helpers/mini-markdown.js";
import { TOP_WORDS, topScript, TOP_LANG_HTML, TOP_LANG_CSS, top } from "./top-i18n.js";

const DOC_CSS = `
body{margin:0;background:var(--bg);color:var(--text);font-family:'IBM Plex Sans KR',system-ui,sans-serif;line-height:1.7}
main{max-width:860px;margin:0 auto;padding:28px 20px 64px}
.back{display:inline-flex;gap:6px;color:var(--muted);text-decoration:none;font-weight:var(--fw-bold);font-size:var(--fs-md);margin-bottom:12px}
h1{font-size:var(--fs-3xl);margin:0 0 12px}h2{font-size:var(--fs-xl);margin:36px 0 10px;padding-top:12px;border-top:1px solid var(--line)}h3{font-size:var(--fs-lg);margin:24px 0 8px}
p,li{font-size:var(--fs-md);color:var(--text)}ul,ol{padding-left:22px}li{margin:4px 0}
a{color:var(--text);text-underline-offset:3px}
code{font-family:ui-monospace,monospace;font-size:var(--fs-sm);background:var(--sunk);border-radius:var(--r-sm);padding:1px 5px;word-break:break-word}
pre{background:var(--panel);border:1px solid var(--line);border-radius:var(--r-lg);padding:14px;overflow:auto}pre code{background:none;padding:0}
.table{overflow-x:auto;border:1px solid var(--line);border-radius:var(--r-lg);background:var(--panel)}
table{border-collapse:collapse;width:100%;font-size:var(--fs-md)}th,td{text-align:left;padding:9px 12px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--muted);font-size:var(--fs-xs);font-weight:700}tr:last-child td{border-bottom:0}
${TOP_LANG_CSS}
.guide-lang{position:fixed;top:16px;right:16px}
`;

export function guidePage(markdown) {
  return `<!doctype html><html lang="ko" class="adm"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title data-top="gd.docTitle">${TOP_WORDS.ko["gd.docTitle"]}</title>${ADMIN_HEAD}<style>${ADMIN_CSS}${DOC_CSS}</style></head><body><div class="guide-lang">${TOP_LANG_HTML}</div><main>
<a class="back" href="/admin" data-top="gd.back">${top("gd.back")}</a>
${renderMarkdown(markdown)}
</main>
<script>${topScript(["gd."])}</script></body></html>`;
}
