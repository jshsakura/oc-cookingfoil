/**
 * A small index of known ROM dumps: CRC-32 → the console and the name the No-Intro and Redump
 * lists give it. The lists are libretro-database's .dat files (metadat/no-intro for cartridges,
 * metadat/redump for discs), CC BY-SA 4.0. The server ships none of them: it downloads the .dat of
 * each system, keeps only { crc → [name, size] } per system under <data>/retro-hashdb/<system>.json,
 * and reads that. With no index nothing is named from a hash and callers fall back to extensions.
 *
 * A hash is the strongest word on what a file is: lookup() is used before the extension, the bytes
 * and the folder it was dropped in (meta/incoming-extras.js).
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import debug from "../debug.js";
import * as env from "../helpers/envs.js";
import { downloadToFile, tmpPathFor } from "../meta/titledb-download.js";

export const DEFAULT_BASE = "https://raw.githubusercontent.com/libretro/libretro-database/master/metadat";
export const STALE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_DAT_BYTES = 128 * 1024 * 1024;
const FOLDERS = ["no-intro", "redump"];

/**
 * The rows of a clrmamepro .dat: [{ name, rom, size, crc }] with `name` the game's name and
 * `rom` the file inside it. Pure.
 */
export function parseDat(text) {
  const rows = [];
  let inGame = false;
  let game = "";
  for (const line of text.split("\n")) {
    if (!inGame) {
      if (line.startsWith("game (")) { inGame = true; game = ""; }
      continue;
    }
    if (line.startsWith(")")) { inGame = false; continue; }
    const name = /^\tname "(.*)"\s*$/.exec(line);
    if (name) { game = name[1]; continue; }
    const rom = /^\trom \( name "(.*)" size (\d+) crc ([0-9A-Fa-f]{8})\b/.exec(line);
    if (rom) rows.push({ name: game, rom: rom[1], size: Number(rom[2]), crc: rom[3].toLowerCase() });
  }
  return rows;
}

/** { crc: [name, size] } from parsed rows; the first row of a crc wins. Pure. */
export function slimRows(rows) {
  const out = {};
  for (const r of rows) if (r.name && !(r.crc in out)) out[r.crc] = [r.name, r.size];
  return out;
}

export function createHashDb({ dir, base = DEFAULT_BASE, download = downloadToFile, now = Date.now } = {}) {
  let index = null; // crc → [{ system, name, size }]
  let refreshing = null;

  const fileOf = (system) => path.join(dir, `${system}.json`);
  const listed = () => {
    try { return fs.readdirSync(dir).filter((n) => n.endsWith(".json")); } catch { return []; }
  };

  function load() {
    const map = new Map();
    for (const f of listed()) {
      const system = f.slice(0, -5);
      try {
        const { rows } = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
        for (const [crc, [name, size]] of Object.entries(rows)) {
          const list = map.get(crc);
          if (list) list.push({ system, name, size }); else map.set(crc, [{ system, name, size }]);
        }
      } catch (err) {
        debug.error("retro hash db: %s: %s", f, err.message);
      }
    }
    return map;
  }

  /** Every dump with this CRC-32 (and this size when given): [{ system, name, size }]. */
  function lookup(crc32, size = null) {
    index ??= load();
    const hits = index.get(String(crc32 ?? "").toLowerCase()) ?? [];
    return size == null ? hits : hits.filter((h) => !h.size || h.size === size);
  }

  /** How many systems are indexed and when the oldest was built: { systems, builtAt }. */
  function status() {
    const times = listed().map((f) => fs.statSync(path.join(dir, f)).mtimeMs);
    return { systems: times.length, builtAt: times.length ? Math.min(...times) : null };
  }

  async function fetchSystem(system, libretroName) {
    for (const folder of FOLDERS) {
      const tmp = tmpPathFor(fileOf(system));
      try {
        const url = `${base}/${folder}/${encodeURIComponent(libretroName)}.dat`;
        const res = await download(url, tmp, { maxBytes: MAX_DAT_BYTES });
        if (res.status !== 200) continue;
        const rows = slimRows(parseDat(await fsp.readFile(tmp, "utf8")));
        const count = Object.keys(rows).length;
        if (!count) continue;
        await fsp.mkdir(dir, { recursive: true });
        const out = tmpPathFor(fileOf(system));
        await fsp.writeFile(out, JSON.stringify({ v: 1, source: folder, rows }));
        await fsp.rename(out, fileOf(system));
        return count;
      } finally {
        await fsp.rm(tmp, { force: true });
      }
    }
    return 0;
  }

  /**
   * Downloads and indexes the lists of `systems` ({ id: { libretro } }); one run at a time.
   * A system whose list cannot be had keeps its older index. { indexed, failed }.
   */
  function refresh(systems) {
    refreshing ??= (async () => {
      let indexed = 0;
      let failed = 0;
      for (const [id, s] of Object.entries(systems)) {
        if (!s.libretro) continue;
        try {
          if (await fetchSystem(id, s.libretro)) indexed++; else failed++;
        } catch (err) {
          failed++;
          debug.error("retro hash db: %s: %s", id, err.message);
        }
      }
      index = null;
      return { indexed, failed };
    })().finally(() => { refreshing = null; });
    return refreshing;
  }

  /** Starts a refresh in the background when there is no index or it is older than STALE_MS. */
  function ensureFresh(systems) {
    const { systems: n, builtAt } = status();
    if (!refreshing && (!n || now() - builtAt > STALE_MS)) refresh(systems).catch(() => {});
  }

  return { lookup, status, refresh, ensureFresh };
}

/** The server's own index, under the data folder; COOK_RETRO_DB_URL names another copy of libretro's metadat folder. */
export const hashDb = createHashDb({ dir: path.join(env.dataDir, "retro-hashdb"), base: process.env.COOK_RETRO_DB_URL || DEFAULT_BASE });
