/**
 * What the admin writes about each game, kept as plain files apart from titledb
 * so no refresh ever overwrites it and nothing of it lives only in a database:
 *
 *   ${COOK_DATA_DIR}/metadata/games/<name> [<base title id>]/game.json
 *     { id, name?, description?, notes? }
 *
 * Each field is text per client language ({ "ko": "…", "ja": "…", "zh-Hant": "…" },
 * the keys of meta/langs.js LANGS) or plain text, which counts as Korean when it
 * has Hangul and as English otherwise (other languages reach English through
 * the usual fallback, so a Korean text is never shown to a German reader).
 *
 * A game is found by the id in brackets at the end of its folder's name; the
 * name before it is for people and may be changed by hand. What is read comes
 * from meta/game-meta.js, which keeps the folders in memory: a game.json edited
 * by hand shows after its next look (once the folder's watch has seen it go
 * quiet, or at once from the admin page), with no restart. A save reads the file again first.
 *
 * name replaces the game's name everywhere it is shown (a wrong or empty one
 * from titledb or the file); one the admin cleared goes back to the usual name.
 *
 * description replaces titledb's own text (for a game it has none for, or a
 * wrong one); one the admin cleared goes back to titledb's. notes is extra
 * information only the admin writes, such as what to install with the game.
 * A reader of a language gets the admin's text in it (plain text in the one it
 * counts as); where a source has the language too (titledb's name or description) that
 * comes next, then English (title-detail.js). Line breaks are kept and shown as written.
 *
 * game-descriptions.json, where this was kept before, is moved into the folders
 * the first time they are read, and removed once every game is there.
 */
import fs from "fs";
import path from "path";
import { dataDir } from "../helpers/envs.js";
import debug from "../debug.js";
import * as gameMeta from "./game-meta.js";
import { FIELDS, readFields } from "./game-meta.js";
import { writeAtomic } from "./game-art-files.js";
import { LANGS } from "./langs.js";

export { FIELDS, GAMES_DIR, folderName, useNames } from "./game-meta.js";
const LEGACY_FILE = path.join(dataDir, "game-descriptions.json");
const FILE = "game.json";
const ID_RE = /^[0-9A-F]{16}$/;
const MAX = 2000;
// A name is one line; the other fields keep their line breaks.
const LIMIT = { name: 120 };
// What the admin reads when a field cannot be saved, whole sentences per field (checkInput).
const CHECK_TEXT = {
  ko: {
    "name.tooLong": "이름은 {limit}자를 넘을 수 없습니다",
    "name.tooLongIn": "이름({lang})은 {limit}자를 넘을 수 없습니다",
    "name.shape": "이름은 글자나 언어별 글자({ \"ko\": \"…\" })로 보냅니다",
    "name.notTextIn": "이름({lang})은 글자로 보냅니다",
    "description.tooLong": "소개는 {limit}자를 넘을 수 없습니다",
    "description.tooLongIn": "소개({lang})는 {limit}자를 넘을 수 없습니다",
    "description.shape": "소개는 글자나 언어별 글자({ \"ko\": \"…\" })로 보냅니다",
    "description.notTextIn": "소개({lang})는 글자로 보냅니다",
    "notes.tooLong": "추가 정보는 {limit}자를 넘을 수 없습니다",
    "notes.tooLongIn": "추가 정보({lang})는 {limit}자를 넘을 수 없습니다",
    "notes.shape": "추가 정보는 글자나 언어별 글자({ \"ko\": \"…\" })로 보냅니다",
    "notes.notTextIn": "추가 정보({lang})는 글자로 보냅니다",
    "unknownLang": "알 수 없는 언어 키입니다: {key}. 쓸 수 있는 키는 {keys} 입니다",
  },
  en: {
    "name.tooLong": "Name cannot be longer than {limit} characters",
    "name.tooLongIn": "Name ({lang}) cannot be longer than {limit} characters",
    "name.shape": "Send name as text or as text per language ({ \"ko\": \"…\" })",
    "name.notTextIn": "Send name ({lang}) as text",
    "description.tooLong": "Description cannot be longer than {limit} characters",
    "description.tooLongIn": "Description ({lang}) cannot be longer than {limit} characters",
    "description.shape": "Send description as text or as text per language ({ \"ko\": \"…\" })",
    "description.notTextIn": "Send description ({lang}) as text",
    "notes.tooLong": "Notes cannot be longer than {limit} characters",
    "notes.tooLongIn": "Notes ({lang}) cannot be longer than {limit} characters",
    "notes.shape": "Send notes as text or as text per language ({ \"ko\": \"…\" })",
    "notes.notTextIn": "Send notes ({lang}) as text",
    "unknownLang": "Unknown language key: {key}. The keys are {keys}",
  },
  ja: {
    "name.tooLong": "名前は {limit} 文字を超えられません",
    "name.tooLongIn": "名前({lang})は {limit} 文字を超えられません",
    "name.shape": "名前は文字列か言語ごとの文字列({ \"ko\": \"…\" })で送ります",
    "name.notTextIn": "名前({lang})は文字列で送ります",
    "description.tooLong": "紹介は {limit} 文字を超えられません",
    "description.tooLongIn": "紹介({lang})は {limit} 文字を超えられません",
    "description.shape": "紹介は文字列か言語ごとの文字列({ \"ko\": \"…\" })で送ります",
    "description.notTextIn": "紹介({lang})は文字列で送ります",
    "notes.tooLong": "追加情報は {limit} 文字を超えられません",
    "notes.tooLongIn": "追加情報({lang})は {limit} 文字を超えられません",
    "notes.shape": "追加情報は文字列か言語ごとの文字列({ \"ko\": \"…\" })で送ります",
    "notes.notTextIn": "追加情報({lang})は文字列で送ります",
    "unknownLang": "不明な言語キーです: {key}。使えるキーは {keys} です",
  },
  zh: {
    "name.tooLong": "名称不能超过 {limit} 个字符",
    "name.tooLongIn": "名称({lang})不能超过 {limit} 个字符",
    "name.shape": "名称请以文本或按语言的文本({ \"ko\": \"…\" })发送",
    "name.notTextIn": "名称({lang})请以文本发送",
    "description.tooLong": "简介不能超过 {limit} 个字符",
    "description.tooLongIn": "简介({lang})不能超过 {limit} 个字符",
    "description.shape": "简介请以文本或按语言的文本({ \"ko\": \"…\" })发送",
    "description.notTextIn": "简介({lang})请以文本发送",
    "notes.tooLong": "附加信息不能超过 {limit} 个字符",
    "notes.tooLongIn": "附加信息({lang})不能超过 {limit} 个字符",
    "notes.shape": "附加信息请以文本或按语言的文本({ \"ko\": \"…\" })发送",
    "notes.notTextIn": "附加信息({lang})请以文本发送",
    "unknownLang": "未知的语言键: {key}。可用的键为 {keys}",
  },
  "zh-Hant": {
      "name.tooLong": "名稱不能超過 {limit} 個字元",
      "name.tooLongIn": "名稱（{lang}）不能超過 {limit} 個字元",
      "name.shape": "請以文字或按語言分類的文字（{ \"ko\": \"…\" }）傳送名稱",
      "name.notTextIn": "請以文字傳送名稱（{lang}）",
      "description.tooLong": "簡介不能超過 {limit} 個字元",
      "description.tooLongIn": "簡介（{lang}）不能超過 {limit} 個字元",
      "description.shape": "請以文字或按語言分類的文字（{ \"ko\": \"…\" }）傳送簡介",
      "description.notTextIn": "請以文字傳送簡介（{lang}）",
      "notes.tooLong": "附加資訊不能超過 {limit} 個字元",
      "notes.tooLongIn": "附加資訊（{lang}）不能超過 {limit} 個字元",
      "notes.shape": "請以文字或按語言分類的文字（{ \"ko\": \"…\" }）傳送附加資訊",
      "notes.notTextIn": "請以文字傳送附加資訊（{lang}）",
      "unknownLang": "未知的語言鍵：{key}。可用的鍵為 {keys}"
  },
  "es": {
      "name.tooLong": "Nombre: no puede superar los {limit} caracteres",
      "name.tooLongIn": "Nombre ({lang}): no puede superar los {limit} caracteres",
      "name.shape": "Nombre: envíe texto o texto por idioma ({ \"ko\": \"…\" })",
      "name.notTextIn": "Nombre ({lang}): envíe texto",
      "description.tooLong": "Descripción: no puede superar los {limit} caracteres",
      "description.tooLongIn": "Descripción ({lang}): no puede superar los {limit} caracteres",
      "description.shape": "Descripción: envíe texto o texto por idioma ({ \"ko\": \"…\" })",
      "description.notTextIn": "Descripción ({lang}): envíe texto",
      "notes.tooLong": "Notas: no puede superar los {limit} caracteres",
      "notes.tooLongIn": "Notas ({lang}): no puede superar los {limit} caracteres",
      "notes.shape": "Notas: envíe texto o texto por idioma ({ \"ko\": \"…\" })",
      "notes.notTextIn": "Notas ({lang}): envíe texto",
      "unknownLang": "Clave de idioma desconocida: {key}. Las claves disponibles son {keys}"
  },
  "fr": {
      "name.tooLong": "Nom : la longueur ne peut pas dépasser {limit} caractères",
      "name.tooLongIn": "Nom ({lang}) : la longueur ne peut pas dépasser {limit} caractères",
      "name.shape": "Nom : envoyez du texte ou du texte par langue ({ \"ko\": \"…\" })",
      "name.notTextIn": "Nom ({lang}) : envoyez du texte",
      "description.tooLong": "Description : la longueur ne peut pas dépasser {limit} caractères",
      "description.tooLongIn": "Description ({lang}) : la longueur ne peut pas dépasser {limit} caractères",
      "description.shape": "Description : envoyez du texte ou du texte par langue ({ \"ko\": \"…\" })",
      "description.notTextIn": "Description ({lang}) : envoyez du texte",
      "notes.tooLong": "Notes : la longueur ne peut pas dépasser {limit} caractères",
      "notes.tooLongIn": "Notes ({lang}) : la longueur ne peut pas dépasser {limit} caractères",
      "notes.shape": "Notes : envoyez du texte ou du texte par langue ({ \"ko\": \"…\" })",
      "notes.notTextIn": "Notes ({lang}) : envoyez du texte",
      "unknownLang": "Clé de langue inconnue : {key}. Les clés disponibles sont {keys}"
  },
  "de": {
      "name.tooLong": "Name: maximal {limit} Zeichen erlaubt",
      "name.tooLongIn": "Name ({lang}): maximal {limit} Zeichen erlaubt",
      "name.shape": "Name: als Text oder als Text je Sprache senden ({ \"ko\": \"…\" })",
      "name.notTextIn": "Name ({lang}): als Text senden",
      "description.tooLong": "Beschreibung: maximal {limit} Zeichen erlaubt",
      "description.tooLongIn": "Beschreibung ({lang}): maximal {limit} Zeichen erlaubt",
      "description.shape": "Beschreibung: als Text oder als Text je Sprache senden ({ \"ko\": \"…\" })",
      "description.notTextIn": "Beschreibung ({lang}): als Text senden",
      "notes.tooLong": "Notizen: maximal {limit} Zeichen erlaubt",
      "notes.tooLongIn": "Notizen ({lang}): maximal {limit} Zeichen erlaubt",
      "notes.shape": "Notizen: als Text oder als Text je Sprache senden ({ \"ko\": \"…\" })",
      "notes.notTextIn": "Notizen ({lang}): als Text senden",
      "unknownLang": "Unbekannter Sprachschlüssel: {key}. Verfügbare Schlüssel: {keys}"
  },
  "it": {
      "name.tooLong": "Nome: non può superare {limit} caratteri",
      "name.tooLongIn": "Nome ({lang}): non può superare {limit} caratteri",
      "name.shape": "Nome: inviare testo o testo per lingua ({ \"ko\": \"…\" })",
      "name.notTextIn": "Nome ({lang}): inviare testo",
      "description.tooLong": "Descrizione: non può superare {limit} caratteri",
      "description.tooLongIn": "Descrizione ({lang}): non può superare {limit} caratteri",
      "description.shape": "Descrizione: inviare testo o testo per lingua ({ \"ko\": \"…\" })",
      "description.notTextIn": "Descrizione ({lang}): inviare testo",
      "notes.tooLong": "Note: non può superare {limit} caratteri",
      "notes.tooLongIn": "Note ({lang}): non può superare {limit} caratteri",
      "notes.shape": "Note: inviare testo o testo per lingua ({ \"ko\": \"…\" })",
      "notes.notTextIn": "Note ({lang}): inviare testo",
      "unknownLang": "Chiave di lingua sconosciuta: {key}. Le chiavi disponibili sono {keys}"
  },
  "pt": {
      "name.tooLong": "Nome: não pode exceder {limit} caracteres",
      "name.tooLongIn": "Nome ({lang}): não pode exceder {limit} caracteres",
      "name.shape": "Nome: envie texto ou texto por idioma ({ \"ko\": \"…\" })",
      "name.notTextIn": "Nome ({lang}): envie texto",
      "description.tooLong": "Descrição: não pode exceder {limit} caracteres",
      "description.tooLongIn": "Descrição ({lang}): não pode exceder {limit} caracteres",
      "description.shape": "Descrição: envie texto ou texto por idioma ({ \"ko\": \"…\" })",
      "description.notTextIn": "Descrição ({lang}): envie texto",
      "notes.tooLong": "Notas: não pode exceder {limit} caracteres",
      "notes.tooLongIn": "Notas ({lang}): não pode exceder {limit} caracteres",
      "notes.shape": "Notas: envie texto ou texto por idioma ({ \"ko\": \"…\" })",
      "notes.notTextIn": "Notas ({lang}): envie texto",
      "unknownLang": "Chave de idioma desconhecida: {key}. As chaves disponíveis são {keys}"
  },
  "nl": {
      "name.tooLong": "Naam: mag niet langer zijn dan {limit} tekens",
      "name.tooLongIn": "Naam ({lang}): mag niet langer zijn dan {limit} tekens",
      "name.shape": "Naam: stuur tekst of tekst per taal ({ \"ko\": \"…\" })",
      "name.notTextIn": "Naam ({lang}): stuur tekst",
      "description.tooLong": "Beschrijving: mag niet langer zijn dan {limit} tekens",
      "description.tooLongIn": "Beschrijving ({lang}): mag niet langer zijn dan {limit} tekens",
      "description.shape": "Beschrijving: stuur tekst of tekst per taal ({ \"ko\": \"…\" })",
      "description.notTextIn": "Beschrijving ({lang}): stuur tekst",
      "notes.tooLong": "Notities: mag niet langer zijn dan {limit} tekens",
      "notes.tooLongIn": "Notities ({lang}): mag niet langer zijn dan {limit} tekens",
      "notes.shape": "Notities: stuur tekst of tekst per taal ({ \"ko\": \"…\" })",
      "notes.notTextIn": "Notities ({lang}): stuur tekst",
      "unknownLang": "Onbekende taalsleutel: {key}. Beschikbare sleutels: {keys}"
  },
  "ru": {
      "name.tooLong": "Название: не более {limit} символов",
      "name.tooLongIn": "Название ({lang}): не более {limit} символов",
      "name.shape": "Название: отправьте текст или текст для каждого языка ({ \"ko\": \"…\" })",
      "name.notTextIn": "Название ({lang}): отправьте текст",
      "description.tooLong": "Описание: не более {limit} символов",
      "description.tooLongIn": "Описание ({lang}): не более {limit} символов",
      "description.shape": "Описание: отправьте текст или текст для каждого языка ({ \"ko\": \"…\" })",
      "description.notTextIn": "Описание ({lang}): отправьте текст",
      "notes.tooLong": "Примечания: не более {limit} символов",
      "notes.tooLongIn": "Примечания ({lang}): не более {limit} символов",
      "notes.shape": "Примечания: отправьте текст или текст для каждого языка ({ \"ko\": \"…\" })",
      "notes.notTextIn": "Примечания ({lang}): отправьте текст",
      "unknownLang": "Неизвестный ключ языка: {key}. Доступные ключи: {keys}"
  },
};
const checkText = (lang, key, vars) => {
  const text = CHECK_TEXT[lang]?.[key] ?? CHECK_TEXT.en[key];
  return text.replace(/\{(\w+)\}/g, (m, name) => (vars[name] === undefined ? m : String(vars[name])));
};
// What a metadata refresh must leave alone when the folder has a picture in the slot.
const ART_LOCKS = [["icon", (s) => s.icon], ["banner", (s) => s.banner], ["screenshots", (s) => s.screens.length > 0]];

/**
 * An entry written by an older version kept the description's languages at the
 * top ({ en, ko }); read it as { description: { en, ko } }. Pure.
 */
export function normalize(raw) {
  const out = {};
  for (const [id, entry] of Object.entries(raw ?? {})) {
    if (!entry || typeof entry !== "object") continue;
    const { en, ko, ...rest } = entry;
    const legacy = (typeof en === "string" || typeof ko === "string") && !rest.description;
    out[id] = legacy ? { ...rest, description: { en: en ?? null, ko: ko ?? null } } : rest;
  }
  return out;
}

// Entries of game-descriptions.json that could not be moved yet: still read, and moved when saved.
let leftover = new Map();

// The game.json layout; a file without one was written by version 1.
export const SCHEMA = 1;
// Keys the server owns in a game.json; every other key (one a later version or a person added) is kept as it is.
const OWN_KEYS = new Set(["id", "version", "locked", ...FIELDS]);

/**
 * A game.json: what was in it beside the server's keys, then the fields.
 * `locked` lists what the admin set by hand, which a metadata refresh will not
 * replace: the fields saved here, and anything else already listed (art). Pure.
 */
function toJson(id, fields, before = {}) {
  const kept = Object.fromEntries(Object.entries(before).filter(([k]) => !OWN_KEYS.has(k)));
  const otherLocks = [...new Set((Array.isArray(before.locked) ? before.locked : []).filter((k) => typeof k === "string" && !FIELDS.includes(k)))];
  const locked = [...FIELDS.filter((f) => fields[f]), ...otherLocks];
  // A file a later version wrote keeps its version: this one only adds what it knows.
  const version = Number.isInteger(before.version) && before.version > SCHEMA ? before.version : SCHEMA;
  const doc = { id, version, ...kept, ...fields, ...(locked.length ? { locked } : {}) };
  return { text: `${JSON.stringify(doc, null, 1)}\n`, empty: !FIELDS.some((f) => fields[f]) && !Object.keys(kept).length && !otherLocks.length };
}

/** What was read of a game's game.json: { fields, raw } or { fields: null, error }; { fields: null } when it has none. */
function readFile(id) {
  const json = gameMeta.entry(id)?.json;
  if (!json) return { fields: null };
  if (json.error) return { fields: null, error: new Error(json.error) };
  return { fields: gameMeta.entry(id).fields, raw: json.raw };
}

/** Keeps `left` (the entries not moved yet) in game-descriptions.json, or removes it when none are left. */
function writeLeftover(left) {
  if (left.size) writeAtomic(LEGACY_FILE, `${JSON.stringify(Object.fromEntries(left), null, 1)}\n`);
  else fs.rmSync(LEGACY_FILE, { force: true });
  // Only once the disk agrees: otherwise what the admin removed would come back on the next start.
  leftover = left;
}

const HANGUL_RE = /[가-힣]/;

/** A field as text per language: plain text is Korean when it has Hangul, else English. Pure. */
const asLangs = (v) => (typeof v === "string" ? { [HANGUL_RE.test(v) ? "ko" : "en"]: v } : { ...(v ?? {}) });

/** A field's text in `lang` (plain text only in the language it counts as). Pure. */
const textIn = (v, lang) => asLangs(v)[lang] || null;

/**
 * Text per language back to what is kept, null when none has any. Never plain text:
 * that would read as Korean or English only, not as the languages sent. Pure.
 */
function gather(byLang) {
  const kept = Object.fromEntries(LANGS.filter((l) => byLang[l]).map((l) => [l, byLang[l]]));
  return Object.keys(kept).length ? kept : null;
}

/** Two sets of fields, `mine` winning language by language (plain text in `mine` wins whole). Pure. */
function mergeFields(old, mine) {
  const out = { ...old };
  for (const [field, text] of Object.entries(mine ?? {})) {
    const next = typeof text === "string" ? text : gather({ ...asLangs(old?.[field]), ...Object.fromEntries(Object.entries(text).filter(([, v]) => v)) });
    if (next) out[field] = next;
  }
  return out;
}

/**
 * Moves game-descriptions.json into the folders. A game whose folder already
 * has a game.json gets only the fields it lacks. An entry that cannot be moved
 * (its game.json is broken, the disk refuses) stays in the old file and is still
 * read from there; the old file goes once nothing is left in it.
 */
function migrateLegacy() {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(LEGACY_FILE, "utf8"));
  } catch (err) {
    if (err.code !== "ENOENT") debug.error("game descriptions: reading %s: %s", LEGACY_FILE, err.message);
    return;
  }
  const left = new Map();
  for (const [key, entry] of Object.entries(normalize(raw))) {
    const id = key.toUpperCase();
    const fields = readFields(entry);
    if (!Object.keys(fields).length) continue;
    if (!ID_RE.test(id)) {
      left.set(key, fields);
      continue;
    }
    try {
      gameMeta.refresh(id);
      const there = readFile(id);
      if (there.error) throw there.error;
      persist(id, mergeFields(fields, there.fields));
    } catch (err) {
      debug.error("game descriptions: %s stays in %s: %s", id, LEGACY_FILE, err.message);
      left.set(id, fields);
    }
  }
  try {
    writeLeftover(left);
    debug.log("game descriptions: moved %s into %s%s", LEGACY_FILE, gameMeta.GAMES_DIR, left.size ? ` (${left.size} left there)` : "");
  } catch (err) {
    debug.error("game descriptions: updating %s: %s", LEGACY_FILE, err.message);
    // The old file is still whole on disk: keep reading every entry from it.
    leftover = new Map(Object.entries(normalize(raw)).map(([k, e]) => [k.toUpperCase(), readFields(e)]));
  }
}

let migrated = false;
/** What the admin wrote about a game, or null; a game.json that cannot be read throws when `strict`. */
function fieldsOf(id, { strict = false } = {}) {
  if (!migrated) {
    migrated = true;
    migrateLegacy();
  }
  const got = readFile(id);
  if (got.error && strict) throw got.error;
  const old = leftover.get(id);
  if (got.error) return old ?? null;
  return old || got.fields ? mergeFields(old, got.fields) : null;
}

function all() {
  fieldsOf(null);
  const out = {};
  for (const id of new Set([...gameMeta.ids(), ...leftover.keys()])) {
    const fields = fieldsOf(id);
    if (fields && Object.keys(fields).length) out[id] = fields;
  }
  return out;
}

/** Writes a game's fields into its folder (made when missing); none left removes its game.json. */
function persist(id, fields) {
  const { text, empty } = toJson(id, fields, readFile(id).raw);
  const label = textIn(fields.name, "ko") ?? textIn(fields.name, "en") ?? Object.values(asLangs(fields.name))[0] ?? null;
  if (!empty) writeAtomic(path.join(gameMeta.ensureFolder(id, label), FILE), text);
  else if (gameMeta.folderOf(id)) {
    const dir = gameMeta.folderOf(id);
    fs.rmSync(path.join(dir, FILE), { force: true });
    // The folder goes too when nothing else (a picture) is in it.
    try {
      fs.rmdirSync(dir);
    } catch { /* not empty */ }
  }
  gameMeta.refresh(id);
  if (leftover.has(id)) writeLeftover(new Map([...leftover].filter(([k]) => k !== id)));
}

const clean = (v, field, limit = LIMIT[field] ?? MAX) => {
  let s = String(v ?? "").replace(/\r\n/g, "\n").trim();
  if (field === "name") s = s.replace(/\s+/g, " ");
  s = s.slice(0, limit);
  return s || null;
};

/** Every game the admin wrote about, by base title id. */
export function edited() {
  return Object.keys(all());
}

/**
 * What a metadata refresh must leave alone for a game: the fields and art the
 * admin set by hand, and the slots with a picture in its folder (icon, banner, screenshots).
 */
export function locked(id) {
  if (!ID_RE.test(String(id))) return [];
  fieldsOf(id);
  const got = readFile(id);
  const list = got.raw?.locked;
  // A file from before the list (0.9.4) holds only what the admin wrote: all of it is theirs.
  const fromFile = Array.isArray(list) ? list.filter((k) => typeof k === "string") : Object.keys(got.fields ?? {});
  const slots = gameMeta.slots(id);
  // Text still in the old file was written by the admin too.
  return [...new Set([...fromFile, ...Object.keys(leftover.get(id) ?? {}), ...ART_LOCKS.filter(([, has]) => has(slots)).map(([k]) => k)])];
}

/**
 * Why `value`, sent for a field, cannot be saved, in words for the admin in `say` (an admin language,
 * Korean when left out); null when it can.
 * It is plain text (Korean when it has Hangul, else English) or { <client language>: text | null }; too long is refused, not cut. Pure.
 */
export function checkInput(field, value, say = "ko") {
  if (value == null) return null;
  const tooLong = (text, lang) => {
    const limit = LIMIT[field] ?? MAX;
    return (clean(text, field, Infinity) ?? "").length > limit ? checkText(say, `${field}.${lang ? "tooLongIn" : "tooLong"}`, { limit, lang }) : null;
  };
  if (typeof value === "string") return tooLong(value, null);
  if (typeof value !== "object" || Array.isArray(value)) return checkText(say, `${field}.shape`, {});
  const unknown = Object.keys(value).find((l) => !LANGS.includes(l));
  if (unknown) return checkText(say, "unknownLang", { key: unknown, keys: LANGS.join(", ") });
  for (const [lang, text] of Object.entries(value)) {
    if (text != null && typeof text !== "string") return checkText(say, `${field}.notTextIn`, { lang });
    const problem = text ? tooLong(text, lang) : null;
    if (problem) return problem;
  }
  return null;
}

/**
 * The admin's text for a game, or null: { name, description, notes }, each null or
 * { <language>: text } with en and ko always there (null when not written). Plain
 * text is given in the language it counts as.
 */
export function get(id) {
  const own = ID_RE.test(String(id)) ? fieldsOf(id) : null;
  if (!own || !Object.keys(own).length) return null;
  const shown = (v) => (v ? { en: null, ko: null, ...asLangs(v) } : null);
  return { name: shown(own.name), description: shown(own.description), notes: shown(own.notes) };
}

/**
 * Save one field. Plain text is kept as sent and read as Korean when it has Hangul,
 * else English. Text per language changes only the languages sent: one sent empty is
 * forgotten, one not sent is kept (plain text already there counts in its one language). Nothing left forgets the field (and the
 * game, when nothing is left). Languages no client reads are ignored: checkInput refuses them first.
 */
export function set(id, field, value) {
  if (!ID_RE.test(String(id)) || !FIELDS.includes(field)) return false;
  // A hand edit since the last look is read before it is written over (or refused, when broken).
  gameMeta.refresh(id);
  // A game.json that cannot be read (a hand edit gone wrong) is not written over: the error says which.
  const { [field]: old, ...others } = fieldsOf(id, { strict: true }) ?? {};
  let next;
  if (typeof value === "string") next = clean(value, field);
  else {
    const byLang = asLangs(old);
    for (const lang of LANGS) if (Object.hasOwn(value ?? {}, lang)) byLang[lang] = clean(value[lang], field);
    next = gather(byLang);
  }
  persist(id, next ? { ...others, [field]: next } : others);
  return true;
}

/** Forget one field, or everything the admin wrote about the game. */
export function reset(id, field = null) {
  if (ID_RE.test(String(id))) gameMeta.refresh(id);
  const own = ID_RE.test(String(id)) ? fieldsOf(id, { strict: true }) : null;
  if (!own || !Object.keys(own).length || (field && !own[field])) return false;
  if (field) return set(id, field, "");
  persist(id, {});
  return true;
}

// The reader's language, else English, else Korean (what the admin wrote beats nothing).
const pick = (text, lang) => textIn(text, lang) ?? textIn(text, "en") ?? textIn(text, "ko");

/** The description a reader sees: the admin's, else `fallback` (titledb's own). */
export function describe(id, lang, fallback = null) {
  return pick(get(id)?.description, lang) ?? fallback ?? null;
}

/** The admin's name for a game in each language it has one in ({ <language>: name }, plain text in the one it counts as), or null. */
export function names(id) {
  const n = get(String(id ?? "").toUpperCase())?.name;
  if (!n) return null;
  const out = Object.fromEntries(Object.entries(n).filter(([, v]) => v));
  return Object.keys(out).length ? out : null;
}

/** What the admin adds about a game (what to install with it, space, version): never from titledb. */
export function notes(id, lang) {
  return pick(get(id)?.notes, lang);
}
