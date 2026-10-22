/**
 * Home-screen forwarders for retro games: one small NSP per game that, when
 * started from the HOME menu, launches the game's RetroArch core with the ROM.
 *
 * The NSP is forwarder/exefs (nx-hbloader that reads its target from romfs,
 * see forwarder/build.sh) plus, per game:
 *   romfs/nextNroPath   sdmc:/retroarch/cores/<core>_libretro_libnx.nro
 *   romfs/nextArgv      that path, then the ROM's SD path in quotes
 *   control/control.nacp, control/icon_AmericanEnglish.dat (the 256-px square cover)
 * packed by hacBrewPack with the console keys. On the console, every core NRO
 * is a whole RetroArch, so the core is what gets launched, not retroarch_switch.nro.
 *
 * Title IDs are 05 + 44 bits of sha256(game id) + 000: the same game always
 * gets the same ID, so reinstalling replaces the old shortcut.
 *
 * NSPs are built when one is asked for, not ahead of time, and kept in
 * <data dir>/retro-forwarders/, named by a key over everything that goes into
 * them, so a changed name, cover, core or ROM path builds a new one (under the
 * same title ID) and the old one is dropped.
 */
import crypto from "crypto";
import { execFile } from "child_process";
import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";
import debug from "../debug.js";

const NACP_SIZE = 0x4000;
const TITLE_ENTRY = 0x300; // name 0x200 + publisher 0x100, UTF-8
const LANGUAGES = 16;
const ICON_MAX = 0x20000;
const BUILD_TIMEOUT_MS = 60_000;
// Bump when the NSP's contents change in a way the key below can't see.
const FORMAT = 1;

const here = path.dirname(fileURLToPath(import.meta.url));
export const EXEFS_DIR = process.env.COOK_FORWARDER_EXEFS || path.resolve(here, "../../forwarder/exefs");
const HACBREWPACK = process.env.COOK_HACBREWPACK_BIN || "hacbrewpack";

/** The forwarder's title ID for a game id: 05, 44 hash bits, 000. Pure. */
export function forwarderTitleId(gameId) {
  const hash = crypto.createHash("sha256").update(String(gameId)).digest("hex");
  return `05${hash.slice(0, 11)}000`.toUpperCase();
}

/**
 * The name on the HOME menu: the Korean title of a "한글명 (English) [patch]"
 * file name, or the whole name without its tags when there's nothing before them. Pure.
 */
export function displayName(name) {
  const noTags = String(name).replace(/\s*\[[^\]]*\]\s*$/, "").trim();
  const beforeParen = noTags.replace(/\s*\((?:[^()]|\([^()]*\))*\)\s*$/, "").trim();
  return beforeParen || noTags || String(name);
}

/** The HOME menu name of a game's shortcut: its display name, then what tells it from its other versions. Pure. */
export const shortcutName = (game) => (game.versionLabel ? `${displayName(game.name)} · ${game.versionLabel}` : displayName(game.name));

/** UTF-8 `text` cut to fit `max` bytes with a terminating NUL, never mid-character. Pure. */
function fitUtf8(text, max) {
  let buf = Buffer.from(text, "utf8");
  if (buf.length < max) return buf;
  let end = max - 1;
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end--;
  return buf.subarray(0, end);
}

/** A control.nacp naming the game in every language slot. Pure. */
export function nacp({ name, publisher, titleId, version = "1.0.0" }) {
  const out = Buffer.alloc(NACP_SIZE);
  const nameBuf = fitUtf8(name, 0x200);
  const pubBuf = fitUtf8(publisher, 0x100);
  for (let i = 0; i < LANGUAGES; i++) {
    nameBuf.copy(out, i * TITLE_ENTRY);
    pubBuf.copy(out, i * TITLE_ENTRY + 0x200);
  }
  const tid = BigInt(`0x${titleId}`);
  out.writeUInt8(0, 0x3025); // StartupUserAccount: none, no user picker
  out.writeUInt8(0, 0x3034); // Screenshot: allowed
  out.writeUInt8(2, 0x3035); // VideoCapture: enabled
  out.writeBigUInt64LE(tid, 0x3038); // PresenceGroupId
  fitUtf8(version, 0x10).copy(out, 0x3060); // DisplayVersion
  out.writeBigUInt64LE(tid + 0x1000n, 0x3070); // AddOnContentBaseId
  out.writeBigUInt64LE(tid, 0x3078); // SaveDataOwnerId
  for (let i = 0; i < 8; i++) out.writeBigUInt64LE(tid, 0x30b0 + i * 8); // LocalCommunicationId
  return out;
}

/**
 * What the forwarder starts: the core NRO and argv with the ROM's SD path, or
 * null when the path can't be quoted safely. `romSdPath` is SD-relative
 * (the bundle's install.rom), so both always point at the same file. Pure.
 */
export function launchTarget(core, romSdPath) {
  if (!core || !romSdPath || /["\0\r\n]/.test(romSdPath) || romSdPath.startsWith("/") || romSdPath.split("/").includes("..")) return null;
  const nroPath = `sdmc:/retroarch/cores/${core}_libretro_libnx.nro`;
  return { nroPath, argv: `${nroPath} "sdmc:/${romSdPath}"` };
}

/**
 * What a homebrew app's forwarder starts: the .nro where the client keeps it,
 * sdmc:/switch/<name>/<name>.nro, or null for a file name that isn't plain. Pure.
 */
export function homebrewTarget(fileName, installPath = null) {
  if (/^switch\/[A-Za-z0-9_-][A-Za-z0-9_.-]*\/[A-Za-z0-9_-][A-Za-z0-9_.-]*\.nro$/i.test(String(installPath ?? ""))) {
    return { nroPath: `sdmc:/${installPath}`, argv: `sdmc:/${installPath}` };
  }
  if (!/^[A-Za-z0-9_.-]+\.nro$/i.test(String(fileName ?? "")) || fileName.startsWith(".")) return null;
  const nroPath = `sdmc:/switch/${fileName.replace(/\.nro$/i, "")}/${fileName}`;
  return { nroPath, argv: nroPath };
}

let exefsHash = null;
function exefsVersion() {
  if (exefsHash === null) {
    const h = crypto.createHash("sha1");
    for (const f of ["main", "main.npdm"]) h.update(fs.readFileSync(path.join(EXEFS_DIR, f)));
    exefsHash = h.digest("hex").slice(0, 12);
  }
  return exefsHash;
}

// The NPDM thread-info capability (kernel capability ending in 0b0111): which CPU
// cores and priorities the forwarder's threads may use. Sphaira writes the same two
// values for its "CPU Cores" choice (source/owo.cpp npdm_kernel_flags).
const THREAD_CAP = { 3: 0x020073b7, 4: 0x030073f7 }; // cores 0-2 and priority 28-59 / cores 0-3 and 28-63
const THREAD_CAP_MASK = 0xf;
const THREAD_CAP_TAG = 0x7;

/**
 * The NPDM with its thread capability, in both ACI0 and ACID, set for `cores`
 * (3, the default, or 4: core 3 is shared with system services, so only for an
 * app that starts a thread there). Throws when the NPDM has no such capability. Pure.
 */
export function npdmForCores(npdm, cores) {
  const want = THREAD_CAP[cores];
  if (!want) throw new Error(`cores must be 3 or 4, not ${cores}`);
  const out = Buffer.from(npdm);
  if (out.toString("latin1", 0, 4) !== "META") throw new Error("not an NPDM");
  const aci0 = out.readUInt32LE(0x70);
  const acid = out.readUInt32LE(0x78);
  const areas = [
    [aci0 + out.readUInt32LE(aci0 + 0x30), out.readUInt32LE(aci0 + 0x34)],
    [acid + out.readUInt32LE(acid + 0x230), out.readUInt32LE(acid + 0x234)],
  ];
  for (const [at, size] of areas) {
    let found = false;
    for (let i = 0; i + 4 <= size; i += 4) {
      if ((out.readUInt32LE(at + i) & THREAD_CAP_MASK) !== THREAD_CAP_TAG) continue;
      out.writeUInt32LE(want, at + i);
      found = true;
      break;
    }
    if (!found) throw new Error("the NPDM has no thread capability");
  }
  return out;
}

/**
 * Whether forwarders can be built here: the exefs, hacBrewPack and prod.keys.
 * The tools are checked once; the keys on every call, since the admin can hand
 * them in while the server runs. A missing piece is logged once.
 */
let availability = null;
let saidNoKeys = false;
export function forwardersAvailable(keysDir) {
  if (availability === null) {
    const missing = [[path.join(EXEFS_DIR, "main.npdm"), "forwarder exefs"]].filter(([p]) => !fs.existsSync(p)).map(([, what]) => what);
    const bin = HACBREWPACK.includes("/") ? HACBREWPACK : null;
    if (bin && !fs.existsSync(bin)) missing.push("hacbrewpack");
    availability = missing.length === 0;
    if (!availability) debug.log("retro: home-screen forwarders off (missing %s)", missing.join(", "));
  }
  if (!availability) return false;
  const keys = fs.existsSync(path.join(keysDir, "prod.keys"));
  if (!keys && !saidNoKeys) debug.log("retro: home-screen forwarders off until prod.keys is there");
  saidNoKeys = !keys;
  return keys;
}

/** Test hook: forget the availability check. */
export function resetAvailability() {
  availability = null;
  saidNoKeys = false;
  exefsHash = null;
}

/**
 * Everything one game's NSP is made of, or null when it can't have one.
 * `game` carries { id, name, core, romSdPath, artKey, publisher }, or a ready
 * `target` ({ nroPath, argv }) in place of core and romSdPath, and `cores`
 * (4 lets its threads use CPU core 3; anything else is the default 3).
 */
export function forwarderSpec(game) {
  const target = game.target ?? launchTarget(game.core, game.romSdPath);
  if (!target) return null;
  const titleId = forwarderTitleId(game.id);
  const name = shortcutName(game);
  const cores = game.cores === 4 ? 4 : 3;
  // The default leaves the key as it always was, so the NSPs already built stay valid.
  const parts = [FORMAT, exefsVersion(), titleId, name, game.publisher, target, game.artKey ?? null, ...(cores === 4 ? [{ cores }] : [])];
  const key = crypto.createHash("sha1").update(JSON.stringify(parts)).digest("hex").slice(0, 12);
  return { titleId, name, publisher: game.publisher, target, key, cores };
}

export const forwarderPath = (outDir, gameId, spec) => path.join(outDir, `${gameId}-${spec.key}.nsp`);

/** The 256-px icon as a baseline JPEG without metadata, as the HOME menu wants it. */
export async function iconJpeg(src) {
  for (const quality of [90, 80, 70]) {
    const buf = await sharp(src, { failOn: "none" })
      .resize(256, 256, { fit: "cover" })
      .flatten({ background: "#000000" })
      .jpeg({ quality, progressive: false, mozjpeg: false, chromaSubsampling: "4:2:0" })
      .toBuffer();
    if (buf.length < ICON_MAX) return buf;
  }
  throw new Error("icon too large");
}

/**
 * The keys hacBrewPack uses, from a prod.keys: header_key and the application
 * key-area keys. It refuses a whole file over one entry it doesn't expect (newer
 * dumps carry some), so it only ever sees these. Pure.
 */
export function packingKeys(prodKeys) {
  return String(prodKeys)
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*(header_key|key_area_key_application_[0-9a-f]{2})\s*=\s*([0-9a-f]+)\s*$/i))
    .filter((m) => m && m[2].length === (m[1] === "header_key" ? 64 : 32))
    .map((m) => `${m[1].toLowerCase()} = ${m[2].toLowerCase()}`)
    .join("\n") + "\n";
}

function run(bin, args, cwd) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { cwd, timeout: BUILD_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${path.basename(bin)}: ${(stderr || stdout || err.message).trim().split("\n").slice(-3).join(" | ")}`));
      else resolve();
    });
  });
}

/** Build one NSP into `dest`. `icon` is an image path or null (generic icon). */
export async function buildForwarder(spec, icon, dest, keysDir) {
  const work = await fsp.mkdtemp(path.join(os.tmpdir(), "cf-fwd-"));
  try {
    const dir = (name) => path.join(work, name);
    await Promise.all(["exefs", "romfs", "control"].map((d) => fsp.mkdir(dir(d))));
    const keys = packingKeys(await fsp.readFile(path.join(keysDir, "prod.keys"), "utf8"));
    await Promise.all([
      fsp.copyFile(path.join(EXEFS_DIR, "main"), path.join(dir("exefs"), "main")),
      fsp.readFile(path.join(EXEFS_DIR, "main.npdm")).then((npdm) => fsp.writeFile(path.join(dir("exefs"), "main.npdm"), spec.cores === 4 ? npdmForCores(npdm, 4) : npdm)),
      fsp.writeFile(dir("keys.dat"), keys, { mode: 0o600 }),
      fsp.writeFile(path.join(dir("romfs"), "nextNroPath"), spec.target.nroPath),
      fsp.writeFile(path.join(dir("romfs"), "nextArgv"), spec.target.argv),
      fsp.writeFile(path.join(dir("control"), "control.nacp"), nacp(spec)),
      icon ? iconJpeg(icon).then((b) => fsp.writeFile(path.join(dir("control"), "icon_AmericanEnglish.dat"), b)) : null,
    ]);
    await run(HACBREWPACK, [
      "-k", dir("keys.dat"),
      "--titleid", spec.titleId.toLowerCase(),
      "--nologo",
      "--exefsdir", dir("exefs"), "--romfsdir", dir("romfs"), "--controldir", dir("control"),
      "--tempdir", dir("temp"), "--ncadir", dir("nca"), "--nspdir", dir("nsp"), "--backupdir", dir("backup"),
    ], work);
    const built = path.join(dir("nsp"), `${spec.titleId.toLowerCase()}.nsp`);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.copyFile(built, `${dest}.tmp`);
    await fsp.rename(`${dest}.tmp`, dest);
  } finally {
    await fsp.rm(work, { recursive: true, force: true });
  }
}

const inFlight = new Map();

/** Removes the item's earlier builds (another name, cover or path) once a new one is made. */
async function dropOlder(outDir, id, keep) {
  const prefix = `${id}-`;
  for (const f of await fsp.readdir(outDir).catch(() => [])) {
    if (f.startsWith(prefix) && /^[0-9a-f]{12}\.nsp$/.test(f.slice(prefix.length)) && f !== path.basename(keep)) {
      await fsp.rm(path.join(outDir, f), { force: true });
    }
  }
}

/** The NSP for one game, built now if it isn't on disk. `game` as for forwarderSpec, plus `icon`. */
export async function ensureForwarder(outDir, game, keysDir) {
  const spec = forwarderSpec(game);
  if (!spec) return null;
  const dest = forwarderPath(outDir, game.id, spec);
  if (fs.existsSync(dest)) return { path: dest, spec };
  if (!inFlight.has(dest)) {
    inFlight.set(dest, buildForwarder(spec, game.icon, dest, keysDir)
      .then(() => dropOlder(outDir, game.id, dest))
      .finally(() => inFlight.delete(dest)));
  }
  await inFlight.get(dest);
  return { path: dest, spec };
}
