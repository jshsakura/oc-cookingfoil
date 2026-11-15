/**
 * An account's Vita and PSP games, gathered from its backups: what each unit's files say (game-facts.js), worked
 * out once when a version is committed and kept beside the units, with the pictures shrunk to jpg. A list or a
 * picture never opens a body again; a unit kept before this was, or one whose kept facts are older than its
 * newest version, is worked out the first time the list is asked for.
 *
 *   <account>/vita/facts/<unit folder>.json   { key, version, kind, bytes, updatedAt, by, facts, art: { role: name } }
 *   <account>/vita/art/<name>.jpg            shrunk pictures, named by the source body and role
 *   <account>/vita/game-art/<game>-<role>    the name of a picture the console sent for a game (keepGameArt)
 *
 * A retail game's sce_sys pictures are encrypted on a card copy, so the console sends them as it reads them; a
 * picture it sent comes before one told from the backups.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import debug from "../debug.js";
import { unitFacts } from "./game-facts.js";
import { ingest } from "../meta/art-ingest.js";
import * as store from "./store.js";

const PLATFORM = "vita";
export const ART_SIZES = { icon: [128, 128], cover: [480, 272], background: [960, 544] };
const ART_NAME = /^[0-9a-f]{16}-(icon|cover|background)\.jpg$/;
// The units a game is told from, best first: a patch's version is the newest, an app's pictures are the game's.
const RANK = { app: 0, patch: 1, "psp-game": 2, "psp-iso": 3, savedata: 4, "psp-save": 5 };
// The kinds that belong to one game; the rest (RetroArch, PSP settings, the licence database) belong to none.
const GAME_KINDS = new Set([...Object.keys(RANK), "addcont", "license", "repatch", "readdcont"]);
const VERSION_RANK = { patch: 0, app: 1, "psp-game": 2, "psp-iso": 3 };

const factsDir = (accountId) => path.join(store.accountDir(accountId), PLATFORM, "facts");
const artDir = (accountId) => path.join(store.accountDir(accountId), PLATFORM, "art");
const factsFile = (accountId, key) => path.join(factsDir(accountId), `${store.unitFolder(key)}.json`);
const sentDir = (accountId) => path.join(store.accountDir(accountId), PLATFORM, "game-art");
const gameFolder = (id) => crypto.createHash("sha256").update(id).digest("hex").slice(0, 16);
const SENT_NAME = /^([0-9a-f]{16})-(icon|cover|background)$/;
export const SENT_ART_MAX = 2 * 1024 * 1024;
const isPicture = (b) => b.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) || b.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex"));

/** Bytes of one file at `where(file)`: a kept body, or a file on a card. What game-facts.js reads. */
export const fileReader = (where) => async (file, offset, length) => {
  const handle = await fsp.open(where(file), "r");
  try {
    const buf = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buf, 0, length, offset);
    return buf.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
};

async function writeAtomic(file, data) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  await fsp.writeFile(tmp, data);
  await fsp.rename(tmp, file);
}

async function shrink(accountId, role, where, read) {
  const name = `${crypto.createHash("sha256").update(`${where.file.sha256}\0${where.offset}\0${where.length}`).digest("hex").slice(0, 16)}-${role}.jpg`;
  const file = path.join(artDir(accountId), name);
  if (fs.existsSync(file)) return name;
  const [width, height] = ART_SIZES[role];
  try {
    await ingest({ input: await read(where.file, where.offset, where.length), spec: { format: "jpeg", width, height, quality: 82, mozjpeg: true, failOn: "none" }, dest: file });
    return name;
  } catch (err) {
    debug.error("backups: a %s picture could not be read: %s", role, err.message);
    return null;
  }
}

/** Works out and keeps one unit's facts from its newest version; drops them when the unit has none left. */
export async function noteUnit(accountId, key) {
  forget(accountId);
  const [latest] = await store.unitVersions(accountId, PLATFORM, key);
  if (!latest) {
    await fsp.rm(factsFile(accountId, key), { force: true });
    return null;
  }
  const read = fileReader((f) => store.blobPath(accountId, f.sha256));
  let facts = null;
  try {
    facts = await unitFacts(latest.manifest, read);
  } catch (err) {
    debug.error("backups: a unit's game facts could not be read: %s", err.message);
  }
  const art = {};
  for (const role of Object.keys(ART_SIZES)) art[role] = facts?.art[role] ? await shrink(accountId, role, facts.art[role], read) : null;
  const rec = {
    key, version: latest.version, kind: latest.manifest.kind, bytes: latest.bytes, updatedAt: latest.createdAt,
    by: latest.by?.label ?? "", facts: facts && { ...facts, art: undefined }, art,
  };
  await writeAtomic(factsFile(accountId, key), JSON.stringify(rec));
  return rec;
}

/** Notes a unit's facts without failing the change that called it. */
export async function noteUnitQuietly(accountId, platform, key) {
  if (platform !== PLATFORM) return;
  try {
    await noteUnit(accountId, key);
  } catch (err) {
    debug.error("backups: game facts were not kept: %s", err.message);
  }
}

async function unitRecords(accountId) {
  const out = [];
  for (const u of await store.listUnits(accountId, PLATFORM)) {
    if (!GAME_KINDS.has(u.kind)) continue;
    let rec = null;
    try {
      rec = JSON.parse(await fsp.readFile(factsFile(accountId, u.key), "utf8"));
    } catch {
      // not kept yet
    }
    if (rec?.version !== u.latest) rec = await noteUnit(accountId, u.key);
    if (rec) out.push(rec);
  }
  return out;
}

const gameIdOf = (rec) => rec.facts?.titleId ?? (rec.kind === "psp-iso" ? `iso:${rec.key.slice(rec.key.indexOf(":") + 1)}` : rec.key.slice(rec.key.indexOf(":") + 1));
const best = (recs, rank) => recs.filter((r) => r.kind in rank).sort((a, b) => rank[a.kind] - rank[b.kind]);
const firstOf = (recs, pick) => {
  for (const r of recs) {
    const v = pick(r);
    if (v != null) return v;
  }
  return null;
};

/**
 * Units' records gathered into games: [{ id, platform, title, region, version, category, bytes, updatedAt,
 * lastDevice, units, art: { icon, cover, background } }], Vita first, then by title. Pure.
 */
export function gatherGames(records) {
  const groups = new Map();
  for (const rec of records.filter((r) => GAME_KINDS.has(r.kind))) {
    const id = gameIdOf(rec);
    groups.set(id, [...(groups.get(id) ?? []), rec]);
  }
  const games = [];
  for (const [id, recs] of groups) {
    const told = best(recs, RANK);
    const newest = recs.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a));
    games.push({
      id,
      platform: firstOf(told, (r) => r.facts?.platform) ?? (recs.some((r) => r.kind.startsWith("psp-")) ? "psp" : "vita"),
      title: firstOf(told, (r) => r.facts?.title),
      region: firstOf(told, (r) => r.facts?.region),
      version: firstOf(best(recs, VERSION_RANK), (r) => r.facts?.version),
      category: firstOf(told, (r) => r.facts?.category),
      bytes: recs.reduce((n, r) => n + r.bytes, 0),
      updatedAt: newest.updatedAt,
      lastDevice: newest.by && newest.by !== "import" ? newest.by : null,
      units: recs.map((r) => r.key).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))),
      art: Object.fromEntries(Object.keys(ART_SIZES).map((role) => [role, firstOf(told, (r) => r.art?.[role])])),
    });
  }
  const order = (g) => (g.platform === "vita" ? 0 : 1);
  return games.sort((a, b) => order(a) - order(b) || (a.title ?? "\uffff").localeCompare(b.title ?? "\uffff") || a.id.localeCompare(b.id));
}

// The pictures consoles sent, by game folder: { <folder>: { role: name } }.
async function sentArt(accountId) {
  const out = {};
  for (const n of await fsp.readdir(sentDir(accountId)).catch(() => [])) {
    const m = SENT_NAME.exec(n);
    const name = m && (await fsp.readFile(path.join(sentDir(accountId), n), "utf8").catch(() => "")).trim();
    if (name && ART_NAME.test(name)) (out[m[1]] ??= {})[m[2]] = name;
  }
  return out;
}

// Telling an account's games reads every unit's facts (740 files for one Vita card), and a screen of icons asks
// for each picture by game, so a told list is kept a moment. What this process keeps drops it at once; an import
// run as its own process is seen within LIST_FRESH_MS.
const LIST_FRESH_MS = 30_000;
const told = new Map();
const forget = (accountId) => told.delete(accountId);

/** The account's games; each `art` names a kept picture or is null. */
export async function listGames(accountId) {
  const kept = told.get(accountId);
  if (kept && Date.now() - kept.at < LIST_FRESH_MS) return kept.games;
  const games = gatherGames(await unitRecords(accountId));
  const sent = await sentArt(accountId);
  const out = games.map((g) => (sent[gameFolder(g.id)] ? { ...g, art: { ...g.art, ...sent[gameFolder(g.id)] } } : g));
  told.set(accountId, { at: Date.now(), games: out });
  return out;
}

/**
 * Keeps a picture a console sent for one of the account's games (`bytes`: a PNG or JPEG). A background is the
 * game's pic0, which is also what its cover was told from, so it makes the cover too. "same" when that picture is
 * already the game's, "kept" when it is now; throws { code: "unit" } for a game the account has no backup of and
 * { code: "picture" } for bytes that are not a picture.
 */
export async function keepGameArt(accountId, id, role, bytes) {
  if (!(role in ART_SIZES)) throw Object.assign(new Error("no such picture"), { code: "unit" });
  if (!(await listGames(accountId)).some((g) => g.id === id)) throw Object.assign(new Error("no such game"), { code: "unit" });
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > SENT_ART_MAX || !isPicture(bytes)) throw Object.assign(new Error("not a picture"), { code: "picture" });
  const roles = role === "background" ? ["background", "cover"] : [role];
  const digest = crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  const pointer = (r) => path.join(sentDir(accountId), `${gameFolder(id)}-${r}`);
  const same = await Promise.all(roles.map(async (r) => {
    const name = `${digest}-${r}.jpg`;
    return (await fsp.readFile(pointer(r), "utf8").catch(() => "")).trim() === name && fs.existsSync(path.join(artDir(accountId), name));
  }));
  if (same.every(Boolean)) return "same";
  for (const r of roles) {
    const name = `${digest}-${r}.jpg`;
    const [width, height] = ART_SIZES[r];
    try {
      await ingest({ input: bytes, spec: { format: "jpeg", width, height, quality: 82, mozjpeg: true, failOn: "none" }, dest: path.join(artDir(accountId), name) });
    } catch {
      throw Object.assign(new Error("not a picture"), { code: "picture" });
    }
    await writeAtomic(pointer(r), name);
  }
  forget(accountId);
  return "kept";
}

/**
 * What the games of a card copy would be, from its scanned units, without keeping anything: counts only.
 * { games, vita, psp, named, icons, covers }
 */
export async function countCardGames(units) {
  const read = fileReader((f) => f.source);
  const records = [];
  for (const u of units.filter((x) => GAME_KINDS.has(x.kind))) {
    const manifest = { kind: u.kind, unit: u.id, files: u.files.filter((f) => !f.secret) };
    const facts = await unitFacts(manifest, read).catch(() => null);
    const art = Object.fromEntries(Object.keys(ART_SIZES).map((role) => [role, facts?.art[role] ? role : null]));
    records.push({ key: `${u.kind}:${u.id}`, kind: u.kind, bytes: 0, updatedAt: 0, by: "import", facts, art });
  }
  const games = gatherGames(records);
  return {
    games: games.length, vita: games.filter((g) => g.platform === "vita").length, psp: games.filter((g) => g.platform === "psp").length,
    named: games.filter((g) => g.title).length, icons: games.filter((g) => g.art.icon).length, covers: games.filter((g) => g.art.cover).length,
  };
}

/** A game as a list sends it: each picture as its address, or null. */
export function gameRow(game, base = "/api/backups/games") {
  const { art, ...rest } = game;
  const at = (role) => (art[role] ? `${base}/${encodeURIComponent(game.id)}/${role}` : null);
  return { ...rest, icon: at("icon"), cover: at("cover"), background: at("background") };
}

/** Sends a kept picture with its name as the ETag, or 404 { error, code: "unit" }. */
export function sendArt(req, res, file) {
  if (!file || !fs.existsSync(file)) return res.status(404).json({ error: "no such picture", code: "unit" });
  const etag = `"${path.basename(file, ".jpg")}"`;
  res.set({ "Cache-Control": "private, no-cache", ETag: etag });
  if (req.get("if-none-match") === etag) return res.status(304).end();
  res.type("image/jpeg").sendFile(file);
}

/** A kept picture's path, or null for a name that is not one. */
export function artPath(accountId, name) {
  return ART_NAME.test(String(name ?? "")) ? path.join(artDir(accountId), name) : null;
}
