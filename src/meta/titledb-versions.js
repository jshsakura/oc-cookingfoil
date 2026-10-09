/**
 * Update and DLC facts from blawar/titledb's versions.json and cnmts.json, the
 * same files nsx-library-manager reads for "Latest Update" and "DLC available".
 *
 *   versions.json  base id → { numeric version → release date } of its updates
 *   cnmts.json     content id → { version → content meta }: the firmware a game
 *                  or update needs, and for DLC the base and update it needs
 *
 * cnmts.json is ~50 MB, so each download is reduced to a small index
 * (versions-index.json) and only that is read on boot.
 */
import fs from "fs/promises";
import path from "path";
import debug from "../debug.js";
import { titledbCacheDir } from "../helpers/envs.js";
import { firmwareString } from "./cnmt-parse.js";

const BASE_URL = "https://raw.githubusercontent.com/blawar/titledb/master";
const SOURCES = ["versions.json", "cnmts.json"];
const INDEX_FILE = "versions-index.json";
const INDEX_VERSION = 1;
const TYPE_APPLICATION = 128;
const TYPE_PATCH = 129;
const TYPE_ADD_ON = 130;
const TITLE_ID_RE = /^[0-9A-F]{16}$/;

let index = emptyIndex();

function emptyIndex() {
  return { version: INDEX_VERSION, updates: {}, firmware: {}, dlcs: {}, dlcRequires: {} };
}

const keyOf = (titleId, version) => `${titleId}@${Number(version) || 0}`;
const upper = (id) => (typeof id === "string" ? id.toUpperCase() : "");

/** Reduces the two raw files to the index served from memory. Pure. */
export function buildIndex(versionsJson, cnmtsJson) {
  const out = emptyIndex();
  for (const [rawId, history] of Object.entries(versionsJson ?? {})) {
    const id = upper(rawId);
    if (!TITLE_ID_RE.test(id) || !history || typeof history !== "object") continue;
    const entries = Object.entries(history)
      .map(([version, date]) => [Number(version), typeof date === "string" ? date : null])
      .filter(([version]) => Number.isInteger(version) && version > 0)
      .sort((a, b) => a[0] - b[0]);
    if (entries.length) out.updates[id] = entries;
  }
  for (const [rawId, byVersion] of Object.entries(cnmtsJson ?? {})) {
    const id = upper(rawId);
    if (!TITLE_ID_RE.test(id) || !byVersion || typeof byVersion !== "object") continue;
    for (const [version, meta] of Object.entries(byVersion)) {
      if (!meta || typeof meta !== "object") continue;
      const key = keyOf(id, version);
      if (meta.titleType === TYPE_APPLICATION || meta.titleType === TYPE_PATCH) {
        const firmware = firmwareString(meta.requiredSystemVersion);
        if (firmware) out.firmware[key] = firmware;
      } else if (meta.titleType === TYPE_ADD_ON) {
        const base = upper(meta.otherApplicationId);
        if (TITLE_ID_RE.test(base)) {
          out.dlcs[base] ??= [];
          if (!out.dlcs[base].includes(id)) out.dlcs[base].push(id);
        }
        if (Number.isInteger(meta.requiredApplicationVersion) && meta.requiredApplicationVersion > 0) {
          out.dlcRequires[key] = meta.requiredApplicationVersion;
        }
      }
    }
  }
  return out;
}

/** Replaces the in-memory index; used by load() and tests. */
export function setIndex(next) {
  index = next?.version === INDEX_VERSION ? next : emptyIndex();
}

export async function load() {
  try {
    setIndex(JSON.parse(await fs.readFile(path.join(titledbCacheDir, INDEX_FILE), "utf8")));
  } catch (err) {
    if (err.code !== "ENOENT") debug.error("titledb-versions: cannot read index: %s", err.message);
    setIndex(null);
  }
  return Object.keys(index.updates).length;
}

export async function hasIndex() {
  try {
    await fs.access(path.join(titledbCacheDir, INDEX_FILE));
    return true;
  } catch {
    return false;
  }
}

async function download(name) {
  const res = await fetch(`${BASE_URL}/${name}`, { redirect: "follow" });
  if (!res.ok) throw new Error(`${name} returned HTTP ${res.status}`);
  return res.json();
}

/** Downloads both sources and rewrites the index; keeps the old one on failure. */
export async function refresh() {
  try {
    const [versionsJson, cnmtsJson] = await Promise.all(SOURCES.map(download));
    const next = buildIndex(versionsJson, cnmtsJson);
    await fs.mkdir(titledbCacheDir, { recursive: true });
    const file = path.join(titledbCacheDir, INDEX_FILE);
    await fs.writeFile(`${file}.tmp`, JSON.stringify(next));
    await fs.rename(`${file}.tmp`, file);
    setIndex(next);
    debug.log("titledb-versions: %d titles with updates, %d with DLC",
      Object.keys(next.updates).length, Object.keys(next.dlcs).length);
    return true;
  } catch (err) {
    debug.error("titledb-versions: refresh failed: %s", err.message);
    return false;
  }
}

/** The newest update version the eShop has published for a base game, or null. */
export function latestVersion(baseTitleId) {
  const history = index.updates[upper(baseTitleId)];
  return history ? history[history.length - 1][0] : null;
}

/** Every published update of a base game, oldest first: [{ version, date }]. */
export function updateHistory(baseTitleId) {
  return (index.updates[upper(baseTitleId)] ?? []).map(([version, date]) => ({ version, date }));
}

/** "16.0.0" for a game or update, or null. */
export function requiredFirmware(titleId, version) {
  return index.firmware[keyOf(upper(titleId), version)] ?? null;
}

/** The base update version a DLC needs, or null. */
export function requiredAppVersion(titleId, version) {
  return index.dlcRequires[keyOf(upper(titleId), version)] ?? null;
}

/**
 * How many DLC exist for a base game. cnmts.json misses recent DLC that the
 * region files already list (and the reverse), so callers pass the region ids.
 */
export function dlcCount(baseTitleId, regionDlcIds = []) {
  return new Set([...(index.dlcs[upper(baseTitleId)] ?? []), ...regionDlcIds]).size;
}
