/**
 * The phone's half of the RetroAchievements sign-in, outside the shop's sign-in
 * like pairing: the console's QR opens it, and the one-time code in the link is
 * all it needs (retro/achievements/link.js). The page seals the password to
 * the console's key in the browser, so it works over plain http too (with a warning).
 *
 *   GET  /ra-link?c=<code>#k=<console key>   the page
 *   GET  /ra-link/app.js                      its script
 *   GET  /ra-link/vendor/<pkg>@<version>/…    @noble/curves, hashes and ciphers for it
 *   GET  /ra-link/api/<code>[?after=<state>]  { state, username, triesLeft, expiresAt };
 *                                             with after, waits up to 25 s for another state. 410 gone
 *   POST /ra-link/api/<code>                  { epk, iv, ct } → 202; 400 malformed, 409 not waiting for one, 410 gone
 */
import express from "express";
import fs from "fs";
import path from "path";
import { createRequire } from "node:module";
import { fileURLToPath } from "url";
import { escapeHtml } from "./admin/escape.js";
import { requestLang } from "../meta/categories.js";
import * as link from "../retro/achievements/link.js";
import { LONG_WAIT_MS } from "./retro-achievements.js";
import { RA_LINK_TEXT } from "./ra-link-text.js";

const require = createRequire(import.meta.url);
const SCRIPT_PATH = fileURLToPath(new URL("../views/ra-link.js", import.meta.url));
const STATES = new Set(["waiting", "sealed", "taken", "done", "wrong", "failed", "unreadable"]);

const VENDOR = ["curves", "hashes", "ciphers"].map((name) => {
  const dir = path.dirname(require.resolve(`@noble/${name}/utils.js`));
  const { version } = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
  return { name, dir, prefix: `/ra-link/vendor/${name}@${version}/` };
});
const IMPORT_MAP = JSON.stringify({ imports: Object.fromEntries(VENDOR.map((v) => [`@noble/${v.name}/`, v.prefix])) });

const STYLE = `:root{color-scheme:light dark;--bg:#F2F1EE;--card:#fff;--ink:#16161A;--muted:#55555E;--line:#E2E0DA;--soft:#F2F1EE;--accent:#FFC23D;--bad:#982929;--good:#2E7D4F;--warn-bg:#FFF4D6;--warn-ink:#6B4A00;font-family:system-ui,sans-serif}
@media (prefers-color-scheme:dark){:root{--bg:#121214;--card:#1C1C20;--ink:#F2F1EE;--muted:#A9A9B2;--line:#2E2E34;--soft:#26262B;--bad:#FF8A80;--good:#7BD69B;--warn-bg:#3A2E10;--warn-ink:#FFD88A}}
*{box-sizing:border-box}body{margin:0;min-height:100svh;display:grid;place-items:center;padding:24px;background:var(--bg);color:var(--ink)}
.card{background:var(--card);border:1px solid var(--line);border-radius:20px;padding:32px;width:min(100%,460px)}
.brand{display:flex;align-items:center;gap:12px;margin:0 0 24px;text-decoration:none;color:inherit}.brand .wm{font-weight:800;font-size:28px;letter-spacing:-.02em}.brand .dot{color:var(--accent)}
h1{font-size:26px;margin:0 0 12px}p{font-size:16px;line-height:1.6;color:var(--muted);margin:0 0 14px;word-break:keep-all}
.note{font-size:14px}.ask{border:2px solid var(--accent);border-radius:12px;padding:12px 14px;margin:0 0 14px}.ask p{margin:0}#ask-who{color:var(--ink);font-weight:700;overflow-wrap:anywhere}.ask-check{font-size:14px;margin-top:6px!important}.warn{background:var(--warn-bg);color:var(--warn-ink);border-radius:12px;padding:12px 14px;font-size:14px;font-weight:600}
label{display:block;font-size:15px;font-weight:600;margin:16px 0 8px}
input{font:inherit;font-size:18px;width:100%;border:1px solid var(--line);border-radius:10px;padding:13px;background:var(--card);color:var(--ink)}
button{display:block;font:inherit;font-weight:700;font-size:18px;width:100%;border:0;border-radius:10px;padding:15px;background:var(--accent);color:#16161A;margin:20px 0 0;cursor:pointer}
button:disabled{opacity:.6;cursor:wait}input:focus-visible,button:focus-visible,a:focus-visible{outline:4px solid #0AB4E8;outline-offset:3px}
#msg{min-height:1.6em;margin:14px 0 0;font-size:16px}#msg.ok{color:var(--good);font-weight:600}#msg.bad{color:var(--bad);font-weight:600}
[hidden]{display:none!important}@media(max-width:420px){body{padding:16px}.card{padding:22px}}`;

/** Inside <script type="application/json">: nothing that closes the tag. Pure. */
const scriptJson = (value) => JSON.stringify(value).replace(/</g, "\\u003c");

export function raLinkPage(lang) {
  const t = RA_LINK_TEXT[lang] ?? RA_LINK_TEXT.en;
  const words = Object.fromEntries(Object.entries(t).filter(([, v]) => typeof v === "string"));
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta name="format-detection" content="telephone=no,email=no,address=no">
<title>${escapeHtml(t.title)} · CookingFoil</title><style>${STYLE}</style>
<script type="importmap">${IMPORT_MAP}</script></head>
<body><main class="card"><p class="brand"><span class="wm">cookingfoil<span class="dot">.</span></span></p>
<h1>${escapeHtml(t.title)}</h1><p>${escapeHtml(t.lead)}</p><p class="note">${escapeHtml(t.note)}</p>
<div class="ask" id="ask" hidden><p id="ask-who"></p><p class="ask-check">${escapeHtml(t.askCheck)}</p></div>
<p class="warn" id="http-warn" role="alert" hidden>${escapeHtml(t.httpWarn)}</p>
<form id="form" novalidate hidden>
<label for="username">${escapeHtml(t.username)}</label><input id="username" maxlength="32" autocomplete="username" autocapitalize="off" spellcheck="false">
<label for="password">${escapeHtml(t.password)}</label><input id="password" type="password" maxlength="256" autocomplete="current-password">
<button type="submit" id="send">${escapeHtml(t.send)}</button></form>
<p id="msg" role="status" aria-live="polite"></p></main>
<script type="application/json" id="ra-text">${scriptJson(words)}</script><script type="module" src="/ra-link/app.js"></script></body></html>`;
}

/** An AbortSignal that fires when the client goes away. */
function closedSignal(res) {
  const ac = new AbortController();
  res.on("close", () => ac.abort());
  return ac.signal;
}

export default function raLinkRouter() {
  const router = express.Router();
  router.get("/ra-link", (req, res) => {
    res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" }).type("html").send(raLinkPage(requestLang(req)));
  });
  router.get("/ra-link/app.js", (_req, res) => res.set("Cache-Control", "no-cache").type("js").sendFile(SCRIPT_PATH));
  for (const v of VENDOR) {
    router.use(v.prefix, (req, res, next) => (req.path.endsWith(".js") ? next() : res.status(404).end()),
      express.static(v.dir, { immutable: true, maxAge: "365d", index: false, fallthrough: false }));
  }

  const api = express.Router();
  // No cookie counts here and nothing is done without the code, so another site has nothing to forge.
  api.use(express.json({ limit: "4kb" }));
  api.use((_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
  api.get("/:code", async (req, res) => {
    const { code } = req.params;
    const after = STATES.has(req.query.after) ? req.query.after : null;
    if (after) await link.wait(code, (l) => l.state !== after, LONG_WAIT_MS, closedSignal(res));
    if (res.writableEnded || res.destroyed) return;
    const v = link.view(code);
    return v ? res.json(v) : res.status(410).json({ error: "no such link" });
  });
  api.post("/:code", (req, res) => {
    const out = link.seal(req.params.code, req.body ?? {});
    if (out === "gone") return res.status(410).json({ error: "no such link" });
    if (out === "invalid") return res.status(400).json({ error: "malformed envelope" });
    if (out === "busy") return res.status(409).json({ error: "the console has not asked for another one" });
    res.status(202).json(link.view(req.params.code));
  });
  router.use("/ra-link/api", api);
  return router;
}
