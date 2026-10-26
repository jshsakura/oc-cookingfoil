/**
 * The generic side of download options (variants). A plugin that provides "variant" says which options a
 * file has (variants hook) and how to send one (plan hook); everything else is here and knows no plugin by
 * name: reading what the console told us, asking the plugins, checking what they answer, picking the
 * reader's language, refusing when an option cannot be served, and making the ETag.
 *
 *   resolve(req, abs, st)    the download of a file whose query names a variant key:
 *                              null                       no variant key in the query: send the file as it is
 *                              { refusal: { status, body } }  409; body is { error, errors, code }
 *                              { variant: { tag, patches, vary } }   send the file with these bytes replaced
 *   list(files, ctx)         the options of several files at once (POST /api/library/variants)
 *   shopInfoExtras(lang)     what plugins add to shop info (features, info keys), kept for a short while
 *
 * What a console says about itself comes in one header, X-CookingFoil-Console: "firmware=21.0.1; region=kor".
 * Only the items core knows are read, only values of the right shape are kept, and a plugin is handed only
 * what its manifest asked for. Nothing here writes it to a log, a record or the disk.
 */
import { createHash } from "node:crypto";
import { pick, requestLang } from "../meta/langs.js";
import { wordsOf } from "./variant-words.js";

export const CONSOLE_HEADER = "X-CookingFoil-Console";
export const MAX_FILES = 200;
const MAX_HEADER_BYTES = 256;
const FIRMWARE_RE = /^\d{1,2}\.\d{1,2}\.\d{1,2}$/;
const REGIONS = new Set(["jpn", "usa", "eur", "aus", "htk", "chn", "kor", "twn"]);
const SHOP_INFO_FRESH_MS = 30_000;
const LIST_PARALLEL = 8;
// Query keys the core keeps for plugins that came before the plugin system: "rewrap" is in every old client's cached shop info.
export const LEGACY_KEYS = Object.freeze(["rewrap"]);
const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;
const CARD_ICONS = ["warning", "info"];
const OPTION_KEY_RE = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;

/** { firmware?, region? } from the header's value; anything not of the right shape is left out. Pure. */
export function parseConsoleHeader(raw) {
  const out = {};
  if (typeof raw !== "string" || raw.length > MAX_HEADER_BYTES) return out;
  for (const part of raw.split(";")) {
    const at = part.indexOf("=");
    if (at < 0) continue;
    const key = part.slice(0, at).trim();
    const value = part.slice(at + 1).trim().toLowerCase();
    if (key === "firmware" && FIRMWARE_RE.test(value)) out.firmware = value;
    else if (key === "region" && REGIONS.has(value)) out.region = value;
  }
  return out;
}

/** A refusal body in the shape every refusal has: `error` (the reader's language), `errors` (all of them), `code`. */
export function refusalBody(texts, code, lang) {
  const map = typeof texts === "string" ? { en: texts } : texts;
  return { error: pick(map, lang) ?? map.en ?? Object.values(map)[0] ?? code, errors: map, code };
}

const stable = (value) => JSON.stringify(value, (_k, v) => (v && typeof v === "object" && !Array.isArray(v) && !Buffer.isBuffer(v)
  ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v));

/** The part of the ETag that says which plugin, which version, which request and which console facts made a response. */
export const variantTag = (id, version, query, consoleUsed) => `p-${createHash("sha256").update(stable([id, version, query, consoleUsed])).digest("hex").slice(0, 12)}`;

/** A texts map ({ lang: text }) or a plain string, checked; null when it is neither. */
function textsOf(value, max = 400) {
  if (typeof value === "string") return value && value.length <= max ? { en: value } : null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (!entries.length || !entries.every(([k, s]) => /^[a-z]{2}(?:-[A-Za-z]{2,4})?$/.test(k) && typeof s === "string" && s && s.length <= max)) return null;
  return value;
}

/** The patches a plan answered, checked against the file: sorted by offset, inside it, not overlapping; null if not. */
export function checkPatches(patches, size) {
  if (!Array.isArray(patches)) return null;
  const out = [];
  for (const p of patches) {
    const bytes = Buffer.isBuffer(p?.bytes) ? p.bytes : p?.bytes instanceof Uint8Array ? Buffer.from(p.bytes) : null;
    if (!bytes || !Number.isSafeInteger(p.offset) || p.offset < 0 || p.offset + bytes.length > size) return null;
    out.push({ offset: p.offset, bytes });
  }
  out.sort((a, b) => a.offset - b.offset);
  for (let i = 1; i < out.length; i++) if (out[i].offset < out[i - 1].offset + out[i - 1].bytes.length) return null;
  return out;
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }));
  return results;
}

export function createVariants(registry, { log = () => {}, now = Date.now } = {}) {
  const refusal = (code, key, lang) => ({ refusal: { status: 409, body: refusalBody(wordsOf(key), code, lang) } });

  /**
   * The first query key a plugin claimed: { id, available, keys } or null. A key the core reserves
   * (LEGACY_KEYS) with no plugin running behind it is never a plain download: old clients ask for it
   * from a cached shop info, and the original file must not stand in for the option they asked for.
   */
  function ownerOf(query) {
    for (const key of Object.keys(query ?? {})) {
      const status = registry.variantKeyStatus(key);
      if (status) return { ...status, keys: registry.keysOf(status.id) };
      if (LEGACY_KEYS.includes(key)) return { id: null, available: false, keys: [] };
    }
    return null;
  }

  async function resolve(req, abs, st) {
    const owner = ownerOf(req.query);
    if (!owner) return null;
    const lang = requestLang(req);
    if (!owner.available) return refusal("variant.unavailable", "unavailable", lang);
    const query = Object.fromEntries(Object.entries(req.query).filter(([k]) => owner.keys.includes(k)));
    const facts = parseConsoleHeader(req.get?.(CONSOLE_HEADER));
    const r = await registry.callHook(owner.id, "plan", { file: abs, size: st.size, mtimeMs: st.mtimeMs, query }, { lang, clientVersion: req.get?.("version") ?? null, console: facts });
    if (r.skipped) return refusal("variant.unavailable", "unavailable", lang);
    if (r.error) {
      log(`${owner.id}: plan failed: ${r.error.message}`);
      return refusal("variant.failed", "failed", lang);
    }
    const answer = r.value;
    if (answer?.refuse) {
      const texts = textsOf(answer.refuse.text);
      const code = typeof answer.refuse.code === "string" && answer.refuse.code.length <= 64 ? answer.refuse.code : null;
      if (texts && code) return { refusal: { status: 409, body: refusalBody(texts, code, lang) } };
      log(`${owner.id}: refusal without a code or text`);
      return refusal("variant.failed", "failed", lang);
    }
    const patches = checkPatches(answer?.patches, st.size);
    if (!patches) {
      log(`${owner.id}: plan answered patches that do not fit the file`);
      return refusal("variant.failed", "failed", lang);
    }
    const used = registry.consoleFor(owner.id, facts);
    // A plugin that asks for console facts always varies on them, header or not: a cache must not hand one console's answer to another.
    return { variant: { tag: variantTag(owner.id, registry.versionOf(owner.id), query, used), patches, vary: registry.consoleWanted(owner.id).length > 0 } };
  }

  /** A dialog as { title, body } of texts maps, or null when it is not one. */
  const dialogOf = (v) => {
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    const title = textsOf(v.title, 200);
    const body = textsOf(v.body, 2000);
    return title && body ? { title, body } : null;
  };

  /**
   * One option as the client gets it, texts in the reader's language:
   *   { id, label, note?, confirm?, progress?, failed?, hashesChange?, query }    an option the client can send
   *   { id, label, blocked: { title, body } }                                   one it shows greyed, with the reason in a window
   * confirm is { title, body }, or one text (older plugins). progress is shown while the server prepares the file, failed
   * when it could not; hashesChange (true) says the bytes differ from the original, so a hash check is not expected to match.
   */
  /** The optional look of an option. A wrong part is left out and the rest stays. */
  const looksOf = (raw) => {
    const color = (v) => (typeof v === "string" && HEX_COLOR_RE.test(v) ? v : null);
    const out = {};
    const b = raw.button;
    if (b && typeof b === "object" && color(b.color) && color(b.text)) out.button = { color: b.color, stripe: color(b.stripe), text: b.text };
    const c = raw.card;
    if (c && typeof c === "object" && color(c.color) && color(c.text)) {
      out.card = { color: c.color, text: c.text, ...(CARD_ICONS.includes(c.icon) ? { icon: c.icon } : {}) };
    }
    return out;
  };

  function optionOf(plugin, raw, lang, keys) {
    if (!raw || typeof raw !== "object" || typeof raw.id !== "string" || !raw.id) return null;
    const label = textsOf(raw.label);
    if (!label) return null;
    const text = (map) => pick(map, lang) ?? map.en ?? Object.values(map)[0];
    const dialog = (d) => ({ title: text(d.title), body: text(d.body) });
    if (raw.blocked !== undefined) {
      const blocked = dialogOf(raw.blocked);
      const extras = ["query", "note", "confirm", "progress", "failed", "hashesChange"];
      if (!blocked || extras.some((k) => raw[k] !== undefined)) return null;
      return { id: raw.id, plugin, label: text(label), blocked: dialog(blocked), ...looksOf(raw) };
    }
    const note = raw.note === undefined ? null : textsOf(raw.note);
    const progress = raw.progress === undefined ? null : textsOf(raw.progress);
    const failed = raw.failed === undefined ? null : textsOf(raw.failed);
    const confirmText = raw.confirm === undefined ? null : textsOf(raw.confirm);
    const confirmDialog = raw.confirm === undefined || confirmText ? null : dialogOf(raw.confirm);
    if ((raw.note !== undefined && !note) || (raw.progress !== undefined && !progress) || (raw.failed !== undefined && !failed)) return null;
    if (raw.confirm !== undefined && !confirmText && !confirmDialog) return null;
    if (raw.hashesChange !== undefined && typeof raw.hashesChange !== "boolean") return null;
    const query = raw.query;
    if (!query || typeof query !== "object" || Array.isArray(query)) return null;
    const entries = Object.entries(query);
    if (!entries.length || !entries.every(([k, v]) => OPTION_KEY_RE.test(k) && keys.includes(k) && typeof v === "string" && v.length <= 64)) return null;
    return {
      id: raw.id, plugin, label: text(label),
      ...(note ? { note: text(note) } : {}),
      ...(confirmText ? { confirm: text(confirmText) } : {}),
      ...(confirmDialog ? { confirm: dialog(confirmDialog) } : {}),
      ...(progress ? { progress: text(progress) } : {}),
      ...(failed ? { failed: text(failed) } : {}),
      ...(raw.hashesChange === true ? { hashesChange: true } : {}),
      ...looksOf(raw),
      query: Object.fromEntries(entries),
    };
  }

  /** files: [{ file, abs, st }] -> { [file]: option[] }. A plugin that is slow or broken adds nothing; the rest still answer. */
  async function list(files, { lang, facts, clientVersion }) {
    const ids = registry.activeProviding("variant");
    const out = {};
    for (const f of files) out[f.file] = [];
    if (!ids.length) return out;
    await mapLimit(files, LIST_PARALLEL, async (f) => {
      const per = await Promise.all(ids.map(async (id) => {
        const r = await registry.callHook(id, "variants", { file: f.file, abs: f.abs, size: f.st.size, mtimeMs: f.st.mtimeMs }, { lang, clientVersion, console: facts });
        if (r.skipped || r.error) return [];
        if (!Array.isArray(r.value)) return [];
        const keys = registry.keysOf(id);
        return r.value.map((raw) => optionOf(id, raw, lang, keys)).filter(Boolean);
      }));
      out[f.file] = per.flat().map(({ plugin: _plugin, ...option }) => option);
    });
    return out;
  }

  // ── shop info ──
  // Per plugin, language, plugin version and prod.keys: a new key file or a new plugin build answers afresh.
  // An answer that did not come (timeout, error, cooling) is not kept as if it had.
  const infoCache = new Map(); // `${id}\0${version}\0${keys}\0${lang}` -> { at, value, pending }
  const EMPTY = Object.freeze({ features: [], info: {} });
  async function extrasOf(id, lang) {
    const key = [id, registry.versionOf(id), registry.keysStamp(), lang].join("\0");
    const hit = infoCache.get(key);
    if (hit?.value && now() - hit.at < SHOP_INFO_FRESH_MS) return hit.value;
    if (hit?.pending) return hit.pending;
    const stale = hit?.value ?? null;
    const pending = registry.callHook(id, "shopInfo", { lang }, { lang }).then((r) => {
      const v = r.value;
      const value = !r.error && !r.skipped && v && typeof v === "object"
        ? { features: Array.isArray(v.features) ? v.features.filter((f) => typeof f === "string" && /^[a-z0-9-]{1,40}$/.test(f)) : [], info: v.info && typeof v.info === "object" && !Array.isArray(v.info) ? v.info : {} }
        : null;
      if (value) infoCache.set(key, { at: now(), value });
      else infoCache.set(key, { at: 0, value: stale });
      return value ?? stale ?? EMPTY;
    });
    infoCache.set(key, { at: hit?.at ?? 0, value: stale, pending });
    return pending;
  }

  /** { features, info } from every plugin that is on and answers shopInfo; info keys are the plugin's to claim, nothing is overwritten by the caller. */
  async function shopInfoExtras(lang) {
    const ids = registry.activeProviding("variant").concat(registry.activeProviding("metadata"), registry.activeProviding("art"), registry.activeProviding("task"));
    const unique = [...new Set(ids)].sort();
    const parts = await Promise.all(unique.map((id) => extrasOf(id, lang)));
    return { features: parts.flatMap((p) => p.features), info: Object.assign({}, ...parts.map((p) => p.info)) };
  }

  /** The variants block of shop info: what to strip from a URL to tell two of one file apart, and what a console is asked for. */
  function shopInfoFacts() {
    const keys = registry.variantKeys();
    const wants = registry.wantedConsole();
    return {
      active: registry.activeProviding("variant").length > 0,
      keys,
      wants,
    };
  }

  return { resolve, list, shopInfoExtras, shopInfoFacts };
}
