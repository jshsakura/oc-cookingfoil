/**
 * 제안: what the library would be better without or with, found by reading what is on disk. Each finding says
 * what was found (code + vars), and which files a person may send to the trash (drops). Nothing here moves a
 * file: the admin page sends a picked drop through the file browser's trash, after showing what goes.
 *
 *   twin        one game, one version, as both an uncompressed and a compressed file (nsp + nsz, xci + xcz)
 *   oldUpdate   a game's newest update in the library is older than the newest published
 *   discMissing a .cue or .m3u names a file that is not beside it
 *   discLone    a disc track (.bin, .img) in a disc console's folder that no list names
 *   noCover     a console's games without box art, one finding per console
 *
 * A finding a person keeps (그대로 두기) stays hidden while its files are the same: its id is a hash of its
 * code and files, so a changed file brings it back.
 *
 *   find({ games, latestVersion, retroGames, systems, discFiles })   [{ id, code, root, files, vars, drops }]
 */
import crypto from "crypto";
import fsp from "fs/promises";
import path from "path";
import { referencedFiles } from "../retro/catalog.js";
import { systemOfFolder } from "../retro/systems.js";

const PAIRS = [[".nsp", ".nsz"], [".xci", ".xcz"]];
const COMPRESSED = new Set(PAIRS.map(([, c]) => c));
const TRACK_EXTS = new Set([".bin", ".img"]);
const LIST_EXTS = new Set([".cue", ".m3u", ".gdi", ".ccd", ".mds"]);
// A .ccd or .mds names its tracks by its own name, not inside the file.
const BY_STEM = { ".ccd": [".img", ".sub"], ".mds": [".mdf"] };
const NAMES_SHOWN = 20;
const ROMS_DEPTH = 3; // <console>/<folder>/<file> under roms/

const ext = (rel) => path.posix.extname(rel).toLowerCase();
const idOf = (code, files, extra = "") => crypto.createHash("sha1").update([code, extra, ...files.map((f) => `${f.rel}\0${f.size ?? ""}`).sort()].join("\n")).digest("hex").slice(0, 16);
const finding = (code, root, files, vars, drops = [], extra = "") => ({ id: idOf(code, files, extra), code, root, files, vars, drops });

function twins(games) {
  const groups = new Map();
  for (const f of games) {
    const pair = PAIRS.find((p) => p.includes(ext(f.rel)));
    if (!pair || !f.titleId || f.version == null) continue;
    const key = `${f.titleId}\0${f.version}\0${pair[0]}`;
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }
  const out = [];
  for (const list of groups.values()) {
    const exts = [...new Set(list.map((f) => ext(f.rel)))];
    if (exts.length < 2) continue;
    const files = list.map(({ rel, size }) => ({ rel, size }));
    const drops = exts.sort((a, b) => Number(COMPRESSED.has(a)) - Number(COMPRESSED.has(b)))
      .map((e) => ({ ext: e.slice(1), rels: list.filter((f) => ext(f.rel) === e).map((f) => f.rel), recommended: !COMPRESSED.has(e) }));
    out.push(finding("twin", "games", files, { name: list[0].name, version: list[0].version, exts: exts.map((e) => e.slice(1)).join(", ") }, drops));
  }
  return out;
}

function oldUpdates(games, latestVersion) {
  const newest = new Map();
  for (const f of games) {
    if (f.kind !== "update" || !f.baseTitleId || f.version == null) continue;
    if (!newest.has(f.baseTitleId) || f.version > newest.get(f.baseTitleId).version) newest.set(f.baseTitleId, f);
  }
  const out = [];
  for (const [base, f] of newest) {
    const latest = latestVersion(base);
    if (latest == null || f.version >= latest) continue;
    out.push(finding("oldUpdate", "games", [{ rel: f.rel, size: f.size }], { name: f.name, have: f.version, latest }, [], String(latest)));
  }
  return out;
}

/** discFiles: [{ rel, size, refs? }] under roms/, refs read from a .cue/.m3u/.gdi. */
function discs(discFiles, systems) {
  const has = new Map(discFiles.map((f) => [f.rel.toLowerCase(), f]));
  const named = new Set();
  const out = [];
  for (const f of discFiles) {
    const e = ext(f.rel);
    if (!LIST_EXTS.has(e)) continue;
    const dir = path.posix.dirname(f.rel);
    const stem = f.rel.slice(0, -e.length);
    const refs = [...(f.refs ?? []).map((r) => path.posix.join(dir, r.replaceAll("\\", "/"))), ...(BY_STEM[e] ?? []).map((x) => stem + x)];
    for (const r of refs) named.add(r.toLowerCase());
    const missing = (f.refs ?? []).filter((r) => !has.has(path.posix.join(dir, r.replaceAll("\\", "/")).toLowerCase()));
    if (missing.length) out.push(finding("discMissing", "retro", [{ rel: f.rel, size: f.size }], { file: path.posix.basename(f.rel), missing: missing.join(", ") }, [], missing.join("\0")));
  }
  for (const f of discFiles) {
    const e = ext(f.rel);
    if (!TRACK_EXTS.has(e) || named.has(f.rel.toLowerCase())) continue;
    const id = systemOfFolder(f.rel.split("/")[1], systems);
    // .bin is also a cartridge ROM (Mega Drive, Atari): only a disc console's folder has tracks.
    if (!id || !systems[id].extensions.includes(".cue")) continue;
    out.push(finding("discLone", "retro", [{ rel: f.rel, size: f.size }], { file: path.posix.basename(f.rel) }, [{ ext: e.slice(1), rels: [f.rel], recommended: false }]));
  }
  return out;
}

function noCovers(retroGames, systems) {
  const bySystem = new Map();
  for (const g of retroGames) if (!g.icon) bySystem.set(g.system, [...(bySystem.get(g.system) ?? []), g]);
  return [...bySystem].map(([id, list]) => {
    const names = list.map((g) => g.name).sort((a, b) => a.localeCompare(b));
    const files = list.map((g) => ({ rel: `roms/${systems[id]?.folder ?? id}/${g.rel}`, size: g.size ?? null }));
    const shown = names.slice(0, NAMES_SHOWN).join(", ") + (names.length > NAMES_SHOWN ? " …" : "");
    return finding("noCover", "retro", files, { system: systems[id]?.names?.ko ?? id, systemId: id, n: list.length, names: shown });
  });
}

export function find({ games = [], latestVersion = () => null, retroGames = [], systems = {}, discFiles = [] }) {
  return [...twins(games), ...oldUpdates(games, latestVersion), ...discs(discFiles, systems), ...noCovers(retroGames, systems)];
}

/** Every disc list and track under <retroDir>/roms, lists with what they name: [{ rel, size, refs? }]. */
export async function readDiscFiles(retroDir, depth = ROMS_DEPTH) {
  const out = [];
  async function walk(rel, left) {
    for (const d of await fsp.readdir(path.join(retroDir, ...rel.split("/")), { withFileTypes: true }).catch(() => [])) {
      if (d.name.startsWith(".")) continue;
      const child = `${rel}/${d.name}`;
      if (d.isDirectory()) { if (left > 1) await walk(child, left - 1); continue; }
      const e = ext(d.name);
      if (!TRACK_EXTS.has(e) && !LIST_EXTS.has(e)) continue;
      const abs = path.join(retroDir, ...child.split("/"));
      const st = await fsp.stat(abs).catch(() => null);
      if (!st) continue;
      const refs = e === ".cue" || e === ".m3u" ? referencedFiles(e, await fsp.readFile(abs, "utf8").catch(() => ""))
        : e === ".gdi" ? gdiTracks(await fsp.readFile(abs, "utf8").catch(() => "")) : undefined;
      out.push({ rel: child, size: st.size, ...(refs ? { refs } : {}) });
    }
  }
  await walk("roms", depth + 1);
  return out;
}

/** The track files a .gdi names: "<n> <lba> <type> <size> <file> <offset>", the file quoted when it has spaces. */
export function gdiTracks(text) {
  const out = [];
  for (const line of text.split(/\r?\n/).slice(1)) {
    const m = /^\s*\d+\s+\d+\s+\d+\s+\d+\s+(?:"([^"]+)"|(\S+))/.exec(line);
    if (m) out.push(m[1] ?? m[2]);
  }
  return out.filter((f) => !path.isAbsolute(f) && !f.split(/[\\/]/).includes(".."));
}

/** The ids a person kept, from <dataDir>/suggestions-kept.json. */
export function createKept(file) {
  const read = () => fsp.readFile(file, "utf8").then((t) => new Set(JSON.parse(t).ids ?? []), () => new Set());
  return {
    read,
    async add(id) {
      const ids = await read();
      ids.add(id);
      await fsp.mkdir(path.dirname(file), { recursive: true });
      await fsp.writeFile(`${file}.tmp`, `${JSON.stringify({ ids: [...ids] }, null, 1)}\n`);
      await fsp.rename(`${file}.tmp`, file);
    },
  };
}
