/**
 * What the admin writes over a retro game's collected metadata, kept in
 * ${COOK_DATA_DIR}/retro-meta-edits.json as { <meta key>: edit } (the key every
 * version of the game shares, build.js metaKey) with
 *
 *   edit = { description?: { ko?, en? }, publisher?, developer?,
 *            releaseDate?: YYYY0000, numberOfPlayers?, genres?: [genre key] }
 *
 * An edit is laid over the record when it is read, so a metadata refresh never
 * undoes it, and a field left empty falls back to what was collected. A game
 * nothing was found for gets a record from the edit alone.
 */
import path from "path";
import debug from "../../debug.js";
import { jsonFile } from "../../helpers/json-file.js";
import { dataDir } from "../../helpers/envs.js";
import { GENRE_LABELS } from "../../meta/categories.js";
import { playersInt, releaseDateInt } from "./fields.js";

const FILE = path.join(dataDir, "retro-meta-edits.json");
const MAX_TEXT = 6000;
const MAX_NAME = 120;
const MAX_GENRES = 4;

const file = jsonFile(FILE);
const all = file.read;

/** For tests and after a restore: read the file again on the next use. */
export function reload() {
  file.forget();
}

/** The edit filed under a meta key, or null. */
export const get = (key) => all()[key] ?? null;

/** Bumped on every save, so caches built from edited records know to rebuild. */
export let version = 0;

const text = (v, max) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const compact = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined && !(typeof v === "object" && !Array.isArray(v) && !Object.keys(v).length)));

/** The edit an admin's form gives, with what can't be stored dropped. Pure. */
export function cleanEdit(input = {}) {
  const genres = Array.isArray(input.genres) ? [...new Set(input.genres.filter((k) => typeof k === "string" && GENRE_LABELS[k]))].slice(0, MAX_GENRES) : [];
  return compact({
    description: compact({ ko: text(input.description?.ko, MAX_TEXT), en: text(input.description?.en, MAX_TEXT) }),
    publisher: text(input.publisher, MAX_NAME),
    developer: text(input.developer, MAX_NAME),
    releaseDate: input.year === "" || input.year === null || input.year === undefined ? null : releaseDateInt(null, input.year),
    numberOfPlayers: input.players === "" || input.players === null || input.players === undefined ? null : playersInt(input.players),
    genres: genres.length ? genres : null,
  });
}

/** Files an edit under a key; an empty one forgets it. Returns what was stored, or null. */
export function set(key, input) {
  const edit = cleanEdit(input);
  const { [key]: _old, ...rest } = all();
  const next = Object.keys(edit).length ? { ...rest, [key]: edit } : rest;
  file.write(next);
  version++;
  return next[key] ?? null;
}

/**
 * `record` with `edit` over it. An edited Korean description is the admin's
 * own, so it no longer carries Wikipedia's attribution. Pure.
 */
export function applyEdit(record, edit) {
  if (!edit) return record;
  const base = record && !record.miss ? record : { source: "admin" };
  const { description, ...fields } = edit;
  const out = { ...base, ...fields };
  if (description) {
    out.description = { ...(base.description ?? {}), ...description };
    if (description.ko) delete out.koFrom;
  }
  return out;
}
