/**
 * POST /api/library/variants { files: ["/Game/game.nsp", ...] }  ->  { variants: { "<file as sent>": [option, ...] } }
 *
 * The download options of several game files at once, asked just before an install: the plugins that
 * provide them answer per file (plugins/variants.js). An option is { id, label, note?, confirm?, query }
 * with the texts already in the reader's language; the client adds `query` to the file's URL and
 * substitutes nothing. A file that is not there, or has no option, answers []. Up to 200 files a call.
 *
 * The answer depends on the reader's language and on what the console says about itself (the
 * X-CookingFoil-Console header), so it carries Vary for both, is private, and its ETag is that of the
 * answer itself: the same console facts and the same options give the same ETag, and a changed
 * firmware changes it. A request with If-None-Match for the current ETag gets 304.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import express from "express";
import { requestLang } from "../meta/langs.js";
import { GAME_FILE_RE, gameFilePath } from "../helpers/file-send.js";
import { CONSOLE_HEADER, MAX_FILES, parseConsoleHeader, refusalBody } from "../plugins/variants.js";
import { wordsOf } from "../plugins/variant-words.js";

const MAX_PATH = 1024;

const statFile = (abs) => new Promise((resolve) => fs.stat(abs, (err, st) => resolve(err || !st.isFile() ? null : st)));

/** The path of a file as the client names it: a path or a URL, without query or fragment. */
function pathOf(raw) {
  if (typeof raw !== "string" || !raw || raw.length > MAX_PATH) return null;
  try { return new URL(raw, "http://x").pathname; } catch { return null; }
}

/** { [file as asked]: option[] } for the game files under `root` that exist; the rest answer []. */
export async function variantsOf({ root, variants }, asked, ctx) {
  const found = [];
  for (const raw of new Set(asked)) {
    const p = pathOf(raw);
    const abs = p && gameFilePath(root, p, GAME_FILE_RE);
    const st = abs && await statFile(abs);
    if (st) found.push({ file: raw, abs, st });
  }
  const listed = await variants().list(found, ctx);
  return Object.fromEntries(asked.map((f) => [f, listed[f] ?? []]));
}

/** The handlers of POST /api/library/variants, to mount on that exact path. */
export default function libraryVariants({ root, variants }) {
  return [express.json({ limit: "256kb" }), async (req, res) => {
    const lang = requestLang(req);
    const refuse = (status, code, key, vars) => res.status(status).set("Cache-Control", "no-store").json(refusalBody(wordsOf(key, vars), code, lang));
    const asked = req.body?.files;
    if (!Array.isArray(asked) || asked.some((f) => typeof f !== "string")) return refuse(400, "variants.badFiles", "badFiles");
    if (asked.length > MAX_FILES) return refuse(400, "variants.tooMany", "tooMany", { max: MAX_FILES });

    const facts = parseConsoleHeader(req.get(CONSOLE_HEADER));
    const out = await variantsOf({ root, variants }, asked, { lang, facts, clientVersion: req.get("version") ?? null });
    const body = JSON.stringify({ variants: out });
    const etag = `W/"${createHash("sha256").update(body).digest("hex").slice(0, 20)}"`;
    res.set({ "Cache-Control": "private, max-age=0", ETag: etag }).vary("Accept-Language").vary(CONSOLE_HEADER);
    if (req.get("if-none-match") === etag) return res.status(304).end();
    res.type("json").send(body);
  }];
}
