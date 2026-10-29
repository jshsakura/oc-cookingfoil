/**
 * What a metadata plugin may answer, cut down to what the core keeps.
 *
 *   parseMetadata(value) -> { fields, credit } | null
 *
 * `null` is an answer the core can not use (not an object): it counts as a failure of the plugin. An
 * object with nothing usable in it is a valid "nothing known", which the runner keeps as a miss.
 *
 *   { fields: { name, description, publisher, releaseDate, size, rank, icon, banner, screenshots }, credit?: { text, url? } }
 *
 * name, description and publisher are text, or text per language ({ "ko": "…" }, keys of meta/langs.js);
 * plain text counts for every language. releaseDate is a whole yyyymmdd number and size a whole number
 * of bytes; rank a whole number from 1 up. Anything else in the answer is dropped, and a field that is wrong is dropped alone.
 *
 * icon and banner are one https address each, screenshots a list of up to MAX_SHOTS. They are not text: the
 * core downloads them itself, once, in the background, only for a slot that is still empty after the
 * admin's upload, the game file and titledb (meta/art-filler.js). A list with one bad address keeps the good ones.
 */
import { LANGS } from "../meta/langs.js";

export const AGENT_FIELDS = Object.freeze(["name", "publisher", "description", "releaseDate", "size"]);
const TEXT_LIMIT = { name: 120, publisher: 120, description: 2000 };
const CREDIT_LIMIT = 200;
const URL_RE = /^https:\/\/[^\s]{1,300}$/;
const PICTURE_URL_RE = /^https:\/\/[^\s]{1,500}$/;
export const MAX_SHOTS = 8;
/** What a plugin may name besides text: pictures, kept by meta/art-fill.js. They take no part in the text fields' order. */
export const ART_FIELDS = Object.freeze(["icon", "banner", "screenshots"]);
/** A plugin may also say how popular a title is: a whole number from 1 (the most popular), read by plugins/agent-values.js agentRank. It has no text order. */
export const RANK_FIELDS = Object.freeze(["rank"]);

// Control characters are dropped; line breaks stay where a description has them.
const clean = (s, limit, lines) => {
  if (typeof s !== "string") return null;
  const t = s.replace(lines ? /[\u0000-\u0009\u000b-\u001f\u007f]/g : /[\u0000-\u001f\u007f]/g, "").trim();
  return t && t.length <= limit ? t : null;
};

function textOf(value, limit, lines) {
  if (typeof value === "string") return clean(value, limit, lines);
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out = {};
  for (const lang of Object.keys(value)) {
    if (!LANGS.includes(lang)) continue;
    const t = clean(value[lang], limit, lines);
    if (t) out[lang] = t;
  }
  return Object.keys(out).length ? out : null;
}

const pictureUrl = (v) => {
  if (typeof v !== "string" || !PICTURE_URL_RE.test(v)) return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" && !u.username && !u.password ? u.href : null;
  } catch {
    return null;
  }
};

const READERS = {
  name: (v) => textOf(v, TEXT_LIMIT.name, false),
  publisher: (v) => textOf(v, TEXT_LIMIT.publisher, false),
  description: (v) => textOf(v, TEXT_LIMIT.description, true),
  releaseDate: (v) => (Number.isInteger(v) && v >= 10000101 && v <= 99991231 ? v : null),
  size: (v) => (Number.isSafeInteger(v) && v > 0 ? v : null),
  rank: (v) => (Number.isSafeInteger(v) && v > 0 && v <= 10_000_000 ? v : null),
  icon: (v) => pictureUrl(v),
  banner: (v) => pictureUrl(v),
  screenshots: (v) => {
    if (!Array.isArray(v)) return null;
    const urls = [...new Set(v.map(pictureUrl).filter(Boolean))].slice(0, MAX_SHOTS);
    return urls.length ? urls : null;
  },
};

export function parseMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const fields = {};
  const given = value.fields && typeof value.fields === "object" ? value.fields : {};
  for (const f of [...AGENT_FIELDS, ...ART_FIELDS, ...RANK_FIELDS]) {
    const v = READERS[f](given[f]);
    if (v !== null) fields[f] = v;
  }
  const out = { fields };
  const c = value.credit;
  const text = c && typeof c === "object" ? clean(c.text, CREDIT_LIMIT, false) : null;
  if (text && Object.keys(fields).length) out.credit = { text, ...(typeof c.url === "string" && URL_RE.test(c.url) ? { url: c.url } : {}) };
  return out;
}
