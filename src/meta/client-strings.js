/**
 * The console client's string tables (i18n/client), served so a client can
 * show a language it was not built with, or a fixed translation, without a new
 * build.
 *
 *   <code>.json      one flat table per language, keyed by the client's English
 *                    source text ("Name|sort"); English has no file
 *   languages.json   [{ code, name, base }]: the language's own name, and the
 *                    one language its missing keys fall back to
 *   locked.json      keys the client never takes from a server (delete
 *                    confirmations, passwords, pairing), exported by the
 *                    client's strings-check; they are left out of every answer
 *
 * The answer for a language is always its whole table: the client keeps what
 * differs from its built-in strings, so the server needs no copy of each
 * build's tables. Everything is read once at start and kept as ready bytes,
 * plain and compressed, so each reply carries its Content-Length (the client
 * shows how much of a language is left).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const DIR = path.join(import.meta.dirname, "../../i18n/client");

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(DIR, name), "utf8"));
}

function load() {
  const languages = readJson("languages.json").map(({ code, name, base }) => ({ code, name, base: base ?? null }));
  const locked = new Set(readJson("locked.json"));
  const answers = new Map();
  for (const { code, base } of languages) {
    const table = code === "en" ? {} : readJson(`${code}.json`);
    const strings = Object.fromEntries(Object.entries(table).filter(([key]) => !locked.has(key)));
    const body = Buffer.from(JSON.stringify({ lang: code, base, strings }));
    const etag = `"cs-${crypto.createHash("sha1").update(body).digest("base64url").slice(0, 16)}"`;
    answers.set(code, {
      etag,
      json: body,
      gzip: zlib.gzipSync(body),
      br: zlib.brotliCompressSync(body, { params: { [zlib.constants.BROTLI_PARAM_SIZE_HINT]: body.length } }),
    });
  }
  return { languages, answers };
}

let loaded = null;
const current = () => (loaded ??= load());

/** The languages a client may offer: [{ code, name, base }]. */
export const clientLanguages = () => current().languages;

/**
 * One language's answer: its ETag and the same JSON as `json`, `gzip` and `br`
 * bytes; null for a language the server has no table for.
 */
export const clientStrings = (code) => current().answers.get(code) ?? null;
