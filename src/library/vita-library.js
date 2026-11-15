/**
 * The PS Vita library: plain files in the vita folder, one folder per game, as the Switch's games folder is.
 *
 *   <Title> [PCSE00123]/<Title> [PCSE00123].vpk           the app, rooted at its app folder (what VitaShell installs)
 *   <Title> [PCSE00123]/<Title> [PCSE00123] [Patch].zip   patch/<ID>/... as on ux0, head.bin kept
 *   <Title> [PCSE00123]/<Title> [PCSE00123] [DLC].zip     addcont/<ID>/<DLC>/... and license/addcont/<ID>/<DLC>/*.rif
 *
 * Every file is read from its zip directory alone: the app's param.sfo (title id, name, APP_VER, region) and
 * whether it carries an icon and a work.bin, the patch's APP_VER, the DLC folders. `license` says what the
 * app's work.bin is bound to: "fake" (NoNpDrm's), "free" (account 0) or "none" (no work.bin: the game needs
 * the console's own licence). Only those words leave here, never the licence's bytes or path.
 *
 * Each file's CRC-32 is read once in the background, one file at a time, and kept by fileKey; it is null
 * until then.
 */
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import zlib from "zlib";
import debug from "../debug.js";
import { entryStream, zipDirectory } from "../helpers/zip-read.js";
import { fileKey } from "../helpers/hash-cache.js";
import { parseSfo } from "../backups/vita-scan.js";
import { vitaDir } from "../helpers/envs.js";
import { appDb } from "../db/database.js";
import { hashStore } from "../db/stores.js";

export const VITA_KINDS = Object.freeze(["app", "patch", "dlc"]);
const TITLE_ID_RE = /^[A-Z]{4}\d{5}$/;
const SFO_MAX = 64 * 1024;
const ICON_MAX = 1024 * 1024;
const LICENSE_HEAD = 16;
// The account id is a little-endian u64: NoNpDrm's 0x0123456789ABCDEF is ef cd ab 89 67 45 23 01 on disk.
const FAKE_ACCOUNT = Buffer.from("0123456789abcdef", "hex").reverse();
const NO_ACCOUNT = Buffer.alloc(8);
const READ_CHUNK = 8 * 1024 * 1024;
// A game folder, and loose files at the top: deeper folders are not read.
const MAX_DEPTH = 2;
// Files put in by hand (not through the admin's browser) show after at most this long.
const RESCAN_MS = 5 * 60 * 1000;
const REGIONS = { UP: "US", EP: "EU", JP: "JP", HP: "AS", KP: "KR" };

/** Which kind a file name is, or null. Pure. */
export function kindOfName(name) {
  if (/\.vpk$/i.test(name)) return "app";
  if (/\[patch\]\.zip$/i.test(name)) return "patch";
  if (/\[dlc\]\.zip$/i.test(name)) return "dlc";
  return null;
}

/** What a work.bin's first 16 bytes say it is bound to: "fake", "free" or "none" (a console account's). Pure. */
export function licenseOf(head) {
  if (!head || head.length < LICENSE_HEAD) return "none";
  const account = head.subarray(8, 16);
  if (account.equals(FAKE_ACCOUNT)) return "fake";
  if (account.equals(NO_ACCOUNT)) return "free";
  return "none";
}

async function entryBytes(abs, entries, name, max) {
  const entry = entries.find((e) => e.name === name);
  if (!entry || entry.size > max) return null;
  const stream = await entryStream(abs, entry);
  if (!stream) return null;
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

const idsUnder = (entries, top) => [...new Set(entries.map((e) => e.name.split("/")).filter((p) => p[0] === top && TITLE_ID_RE.test(p[1] ?? "")).map((p) => p[1]))];

async function readApp(abs) {
  const entries = await zipDirectory(abs).catch(() => []);
  if (!entries.length) return null;
  const sfo = parseSfo((await entryBytes(abs, entries, "sce_sys/param.sfo", SFO_MAX).catch(() => null)) ?? Buffer.alloc(0));
  if (!sfo || !TITLE_ID_RE.test(sfo.TITLE_ID ?? "")) return null;
  const head = await entryBytes(abs, entries, "sce_sys/package/work.bin", LICENSE_HEAD * 64).catch(() => null);
  return {
    id: sfo.TITLE_ID,
    name: sfo.TITLE || null,
    version: sfo.APP_VER || null,
    region: REGIONS[String(sfo.CONTENT_ID ?? "").slice(0, 2)] ?? null,
    icon: entries.some((e) => e.name === "sce_sys/icon0.png"),
    license: licenseOf(head),
  };
}

async function readPatch(abs) {
  const entries = await zipDirectory(abs).catch(() => []);
  const [id] = idsUnder(entries, "patch");
  if (!id) return null;
  const sfo = parseSfo((await entryBytes(abs, entries, `patch/${id}/sce_sys/param.sfo`, SFO_MAX).catch(() => null)) ?? Buffer.alloc(0));
  return { id, version: sfo?.APP_VER || null };
}

async function readDlc(abs) {
  const entries = await zipDirectory(abs).catch(() => []);
  const [id] = idsUnder(entries, "addcont");
  if (!id) return null;
  const count = new Set(entries.map((e) => e.name.split("/")).filter((p) => p[0] === "addcont" && p[1] === id && p.length > 3).map((p) => p[2])).size;
  return { id, count };
}

const READERS = { app: readApp, patch: readPatch, dlc: readDlc };

async function walk(dir, rel, depth, out) {
  let entries;
  try {
    entries = await fsp.readdir(path.join(dir, rel), { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const sub = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (depth < MAX_DEPTH) await walk(dir, sub, depth + 1, out);
    } else if (e.isFile() && kindOfName(e.name)) out.push(sub);
  }
}

/**
 * The library over the folder `dir()` returns, with CRCs kept in `crcs` (a hashStore).
 *   list()            the games, read again after invalidate() or RESCAN_MS
 *   file(id, kind)    { abs, name, size, key } of that game's file, or null
 *   icon(id)          its icon0.png, or null
 *   fillCrcs()        reads the CRC of every file that has none yet, one at a time
 *   known()           the games of the last read, without reading (for the file browser's facts)
 */
export function createVitaLibrary({ dir, crcs, now = Date.now }) {
  // Each file's facts, kept by its fileKey so a rescan reads only what changed.
  const facts = new Map();
  let games = null;
  let scannedAt = 0;
  let scanning = null;

  async function scan() {
    const root = dir();
    if (!root || !fs.existsSync(root)) return [];
    const rels = [];
    await walk(root, "", 1, rels);
    const byId = new Map();
    const seen = new Set();
    for (const rel of rels.sort()) {
      const abs = path.join(root, rel);
      const kind = kindOfName(rel);
      let st;
      try {
        st = await fsp.stat(abs);
      } catch {
        continue;
      }
      const key = fileKey(st);
      seen.add(abs);
      let fact = facts.get(abs);
      if (fact?.key !== key) {
        fact = { key, read: await READERS[kind](abs).catch(() => null) };
        facts.set(abs, fact);
      }
      if (!fact.read) continue;
      const game = byId.get(fact.read.id) ?? { id: fact.read.id, files: {} };
      // Two files of one kind for a game: the first by name is listed, as the scan reads them.
      if (!game.files[kind]) game.files[kind] = { kind, abs, rel, name: path.basename(rel), size: st.size, key, ...fact.read };
      byId.set(fact.read.id, game);
    }
    for (const abs of [...facts.keys()]) if (!seen.has(abs)) facts.delete(abs);
    return [...byId.values()].filter((g) => g.files.app).sort((a, b) => String(a.files.app.name ?? a.id).localeCompare(String(b.files.app.name ?? b.id)));
  }

  async function list() {
    if (games && now() - scannedAt < RESCAN_MS) return games;
    scanning ??= scan().then((g) => { scannedAt = now(); return (games = g); }).finally(() => (scanning = null));
    return scanning;
  }

  const crcOf = (f) => {
    const hit = crcs.get(f.abs);
    return hit?.key === f.key ? hit.hash : null;
  };

  async function file(id, kind) {
    const g = (await list()).find((x) => x.id === id);
    const f = g?.files[kind];
    return f ? { abs: f.abs, name: f.name, size: f.size, key: f.key, crc32: crcOf(f) } : null;
  }

  async function icon(id) {
    const f = await file(id, "app");
    if (!f) return null;
    const entries = await zipDirectory(f.abs).catch(() => []);
    return entryBytes(f.abs, entries, "sce_sys/icon0.png", ICON_MAX).catch(() => null);
  }

  async function crcFile(abs) {
    let crc = 0;
    for await (const chunk of fs.createReadStream(abs, { highWaterMark: READ_CHUNK })) crc = zlib.crc32(chunk, crc);
    return (crc >>> 0).toString(16).padStart(8, "0");
  }

  let filling = null;
  /** Reads the CRC of every listed file that has none for its present state. Resolves to how many it read. */
  function fillCrcs() {
    filling ??= (async () => {
      let read = 0;
      const all = (await list()).flatMap((g) => Object.values(g.files));
      for (const f of all) {
        if (crcOf(f)) continue;
        try {
          const st = await fsp.stat(f.abs);
          if (fileKey(st) !== f.key) continue;
          crcs.set(f.abs, { key: f.key, hash: await crcFile(f.abs) });
          read++;
        } catch (err) {
          debug.error("vita library: a file's CRC could not be read: %s", err.code ?? err.message);
        }
      }
      crcs.prune(new Set(all.map((f) => f.abs)));
      return read;
    })().finally(() => (filling = null));
    return filling;
  }

  function invalidate() {
    games = null;
  }

  return { list, file, icon, fillCrcs, invalidate, crcOf, known: () => games ?? [] };
}

let shared = null;
/** The server's one library over the vita folder. */
export const vitaLibrary = () => (shared ??= createVitaLibrary({ dir: () => vitaDir, crcs: hashStore(appDb(), "vita-crc") }));
