/**
 * What a Vita's ux0: holds, as backup units, read the way the Vita client reads it (the Vita repo's
 * core/Scan.cpp, core/Sfo.cpp and core/Manifest.cpp): the same units, files, order and manifest text, so the
 * import tool and the console make the same manifest for the same card. Only regular files and folders are
 * read; a link is never followed. Secret files are never opened: only their size and time are taken.
 */
import fsp from "node:fs/promises";
import path from "node:path";
import vita from "../platforms/vita.js";

const byBytes = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));
const isTitleId = (name) => /^[A-Z0-9]{9}$/.test(name);
const lower = (s) => s.toLowerCase();

// A folder's entries in name order: files and folders only, as lstat sees them.
async function list(dir) {
  let names;
  try {
    names = await fsp.readdir(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    let st;
    try {
      st = await fsp.lstat(path.join(dir, name));
    } catch {
      continue;
    }
    if (!st.isDirectory() && !st.isFile()) continue;
    out.push({ name, dir: st.isDirectory(), size: st.size, mtime: Math.floor(st.mtimeMs / 1000) });
  }
  return out.sort((a, b) => byBytes(a.name, b.name));
}

async function walk(dir, prefix, kind, out) {
  for (const node of await list(dir)) {
    const rel = prefix ? `${prefix}/${node.name}` : node.name;
    if (node.dir) await walk(path.join(dir, node.name), rel, kind, out);
    else out.push({ path: rel, size: node.size, mtime: node.mtime, secret: vita.isSecretPath(kind, rel), source: path.join(dir, node.name) });
  }
}

const sortFiles = (files) => files.sort((a, b) => byBytes(a.path, b.path));

async function folderUnit(ux0, kind, id, root) {
  const files = [];
  await walk(path.join(ux0, root), "", kind, files);
  return { kind, id, root, title: "", version: "", category: "", files: sortFiles(files) };
}

/** The text values of a param.sfo, or null when it is not one (read as the Vita client reads it). */
export function parseSfo(data) {
  const le32 = (at) => data.readUInt32LE(at);
  const le16 = (at) => data.readUInt16LE(at);
  if (data.length < 20 || le32(0) !== 0x46535000) return null;
  const keys = le32(8);
  const values = le32(12);
  const count = le32(16);
  if (keys > data.length || values > data.length || count > Math.floor((data.length - 20) / 16)) return null;
  const text = {};
  for (let i = 0; i < count; i++) {
    const entry = 20 + i * 16;
    const keyAt = keys + le16(entry);
    const format = le16(entry + 2);
    const length = le32(entry + 4);
    const valueAt = values + le32(entry + 12);
    if (keyAt >= data.length || valueAt > data.length || length > data.length - valueAt) return null;
    let end = keyAt;
    while (end < data.length && data[end]) end++;
    const key = data.subarray(keyAt, end).toString("latin1");
    if (!key) return null;
    if (format === 0x0404) {
      if (length !== 4) return null;
    } else if (format === 0x0204 || format === 0x0004) {
      const raw = data.subarray(valueAt, valueAt + length);
      const nul = raw.indexOf(0);
      text[key] = (nul < 0 ? raw : raw.subarray(0, nul)).toString("utf8");
    }
  }
  return text;
}

async function withSfo(ux0, unit) {
  let data;
  try {
    const handle = await fsp.open(path.join(ux0, unit.root, "sce_sys/param.sfo"), "r");
    try {
      const buf = Buffer.alloc(64 * 1024);
      const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
      data = buf.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  } catch {
    return;
  }
  const sfo = parseSfo(data);
  if (!sfo) return;
  unit.title = sfo.TITLE ?? "";
  unit.version = sfo.APP_VER ?? "";
  unit.category = sfo.CATEGORY ?? "";
}

async function titles(ux0, at, kind, sfo, out) {
  for (const node of await list(path.join(ux0, at))) {
    if (!node.dir || !isTitleId(node.name)) continue;
    const unit = await folderUnit(ux0, kind, node.name, `${at}/${node.name}`);
    if (sfo) await withSfo(ux0, unit);
    out.push(unit);
  }
}

async function group(ux0, at, kind, id, names, out) {
  const files = [];
  for (const node of await list(path.join(ux0, at))) {
    if (names.length && !names.includes(node.name)) continue;
    if (node.dir) await walk(path.join(ux0, at, node.name), node.name, kind, files);
    else files.push({ path: node.name, size: node.size, mtime: node.mtime, secret: vita.isSecretPath(kind, node.name), source: path.join(ux0, at, node.name) });
  }
  if (files.length) out.push({ kind, id, root: at, title: "", version: "", category: "", files: sortFiles(files) });
}

/** Every unit under `ux0` (a card or a copy of one), in the client's order. */
export async function scanUx0(ux0) {
  const out = [];
  await titles(ux0, "app", "app", true, out);
  await titles(ux0, "patch", "patch", true, out);
  for (const title of await list(path.join(ux0, "addcont"))) {
    if (!title.dir || !isTitleId(title.name)) continue;
    for (const dlc of await list(path.join(ux0, "addcont", title.name))) {
      if (dlc.dir) out.push(await folderUnit(ux0, "addcont", `${title.name}/${dlc.name}`, `addcont/${title.name}/${dlc.name}`));
    }
  }
  // A title's licences, for the game and its DLC, as one unit: the DLC's come after the game's, as the client lists them.
  for (const title of await list(path.join(ux0, "license/app"))) {
    if (!title.dir || !isTitleId(title.name)) continue;
    const unit = await folderUnit(ux0, "license", title.name, `license/app/${title.name}`);
    const dlcDir = path.join(ux0, "license/addcont", title.name);
    if ((await fsp.lstat(dlcDir).catch(() => null))?.isDirectory()) await walk(dlcDir, "addcont", "license", unit.files);
    out.push(unit);
  }
  await group(ux0, "license", "license-db", "license.db", ["license.db"], out);
  await titles(ux0, "user/00/savedata", "savedata", false, out);
  await titles(ux0, "repatch", "repatch", false, out);
  await titles(ux0, "reAddcont", "readdcont", false, out);
  for (const disc of await list(path.join(ux0, "pspemu/ISO"))) {
    const name = lower(disc.name);
    if (disc.dir || !(name.endsWith(".iso") || name.endsWith(".cso"))) continue;
    out.push({ kind: "psp-iso", id: disc.name, root: "pspemu/ISO", title: "", version: "", category: "",
      files: [{ path: disc.name, size: disc.size, mtime: disc.mtime, secret: false, source: path.join(ux0, "pspemu/ISO", disc.name) }] });
  }
  await titles(ux0, "pspemu/PSP/GAME", "psp-game", false, out);
  await titles(ux0, "pspemu/PSP/SAVEDATA", "psp-save", false, out);
  await group(ux0, "pspemu/seplugins", "psp-config", "seplugins", [], out);
  const ra = "data/retroarch";
  await group(ux0, ra, "ra-save", "savefiles", ["savefiles"], out);
  await group(ux0, ra, "ra-state", "states", ["states"], out);
  await group(ux0, ra, "ra-config", "config", ["retroarch.cfg", "retroarch-core-options.cfg", "config", "remaps"], out);
  await group(ux0, ra, "ra-system", "system", ["system"], out);
  return out;
}

/** A unit's manifest, its files hashed by `hash(file)` (an async sha256 hex); secrets get no hash. */
export async function manifestOf(unit, hash) {
  const files = [];
  const secrets = [];
  for (const f of unit.files) {
    if (f.secret) secrets.push({ path: f.path, size: f.size, mtime: f.mtime });
    else files.push({ path: f.path, size: f.size, mtime: f.mtime, sha256: await hash(f) });
  }
  return { format: 1, platform: "vita", kind: unit.kind, unit: unit.id, root: unit.root, title: unit.title,
    version: unit.version, category: unit.category, files, secrets };
}
