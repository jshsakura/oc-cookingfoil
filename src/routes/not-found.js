/**
 * The last stop of every request no route took. A browser gets a page in its own
 * language with a way on, an API caller a JSON answer, and anything else (a console,
 * curl) the plain word, so nothing that reads the body has to parse a page.
 */
import { requestLang } from "../meta/langs.js";
import { TOP_WORDS } from "./admin/top-i18n.js";

const API_RE = /^\/(admin\/)?api\//;

const page = (lang, w) => /* html */ `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${w["nf.title"]}</title><style>
:root{color-scheme:light dark;--bg:#f1f0ec;--text:#26251f;--muted:#6f6d65;--line:#d9d7cf}
@media (prefers-color-scheme:dark){:root{--bg:#1b1a17;--text:#eceae3;--muted:#a3a198;--line:#3a3833}}
body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:16px;box-sizing:border-box;background:var(--bg);color:var(--text);font:16px/1.6 system-ui,sans-serif;text-align:center}
img{display:block;margin:0 auto 16px}h1{margin:0 0 8px;font-size:22px}p{margin:0 0 20px;color:var(--muted)}
a{display:inline-block;padding:10px 18px;border:1px solid var(--line);border-radius:999px;color:inherit;text-decoration:none;font-weight:700}
</style></head><body><main><img src="/assets/cookingfoil.svg" alt="" width="56" height="56"><h1>${w["nf.title"]}</h1><p>${w["nf.publicBody"]}</p><a href="/">${w["nf.front"]}</a></main></body></html>`;

export function notFound() {
  return (req, res) => {
    res.status(404);
    if (API_RE.test(req.path)) return res.json({ error: "not-found" });
    if (req.method !== "GET" || !req.get("accept")?.includes("text/html")) return res.type("text/plain").send("Not Found\n");
    const lang = requestLang(req);
    return res.type("html").send(page(lang, TOP_WORDS[lang] ?? TOP_WORDS.en));
  };
}
