/**
 * What a Vita backup unit says about its game, read from the unit's own files and nothing else: the param.sfo
 * (title, app version, content id, category), and the pictures beside it. A PSP game folder may hold them inside
 * its EBOOT.PBP, and a PSP disc image inside the ISO 9660 tree under PSP_GAME. Secret files are never read.
 *
 * `read(file, offset, length)` gives bytes of one manifest file; the store reads its kept body, a dry run the card.
 */
import { parseSfo } from "./vita-scan.js";

const SFO_MAX = 64 * 1024;
const PICTURE_MAX = 4 * 1024 * 1024;
const SECTOR = 2048;
const DIR_MAX = 256 * 1024;

const VITA_REGIONS = { UP: "US", EP: "EU", JP: "JP", HP: "ASIA", KP: "ASIA" };
const VITA_TITLE_REGIONS = { PCSA: "US", PCSE: "US", PCSB: "EU", PCSF: "EU", PCSC: "JP", PCSG: "JP", PCSD: "ASIA", PCSH: "ASIA" };
const PSP_DISC_REGIONS = { US: "US", ES: "EU", JS: "JP", JM: "JP", AS: "ASIA", KS: "ASIA" };

/** "US" | "EU" | "JP" | "ASIA" | null, from a content id first, then the title or disc id. */
export function regionOf({ contentId, titleId, psp }) {
  const byContent = VITA_REGIONS[String(contentId ?? "").slice(0, 2)];
  if (byContent) return byContent;
  const id = String(titleId ?? "");
  return (psp ? PSP_DISC_REGIONS[id.slice(2, 4)] : VITA_TITLE_REGIONS[id.slice(0, 4)]) ?? null;
}

// Where each kind keeps its param.sfo and pictures, relative to its root.
const VITA_FILES = { sfo: "sce_sys/param.sfo", icon: "sce_sys/icon0.png", cover: "sce_sys/pic0.png", background: ["sce_sys/livearea/contents/bg.png", "sce_sys/livearea/contents/bg0.png"] };
const PSP_FILES = { sfo: "PARAM.SFO", icon: "ICON0.PNG", cover: "PIC1.PNG", background: "PIC1.PNG" };

const kindPlatform = (kind) => (kind.startsWith("psp-") ? "psp" : "vita");

/**
 * The facts of one unit: { titleId, platform, title, version, region, category, art: { icon, cover, background } }
 * where each art entry says where its bytes are ({ file, offset, length }) or is null. Null for a unit that names
 * no game.
 */
export async function unitFacts(manifest, read) {
  const files = new Map(manifest.files.map((f) => [f.path.toLowerCase(), f]));
  const kind = manifest.kind;
  if (kind === "psp-iso") return isoFacts(manifest, read);
  if (kind === "psp-save") return pspSaveFacts(manifest, files, read);
  if (kind === "psp-game") {
    const eboot = files.get("eboot.pbp");
    if (!files.get("param.sfo") && eboot) return pbpFacts(manifest, eboot, read);
  }
  const layout = kind.startsWith("psp-") ? PSP_FILES : VITA_FILES;
  const at = (name) => {
    for (const n of [name].flat()) {
      const f = files.get(n.toLowerCase());
      if (f) return { file: f, offset: 0, length: f.size };
    }
    return null;
  };
  const sfo = await readSfo(at(layout.sfo), read);
  return facts(manifest.unit, kindPlatform(kind), sfo, { icon: at(layout.icon), cover: at(layout.cover), background: at(layout.background) });
}

function facts(titleId, platform, sfo, art) {
  const id = platform === "psp" ? sfo?.DISC_ID || titleId : titleId;
  return {
    titleId: id,
    platform,
    title: clean(sfo?.TITLE),
    version: clean(sfo?.APP_VER) ?? (platform === "psp" ? clean(sfo?.DISC_VERSION) : null),
    region: regionOf({ contentId: sfo?.CONTENT_ID, titleId: id, psp: platform === "psp" }),
    category: clean(sfo?.CATEGORY),
    art: Object.fromEntries(Object.entries(art).map(([k, v]) => [k, v && v.length > 0 && v.length <= PICTURE_MAX ? v : null])),
  };
}

const clean = (v) => {
  const s = typeof v === "string" ? v.replace(/\p{Cc}+/gu, " ").trim() : "";
  return s ? s.slice(0, 128) : null;
};

async function readSfo(where, read) {
  if (!where || where.length > SFO_MAX) return null;
  return parseSfo(await read(where.file, where.offset, where.length));
}

// A PSP save's PARAM.SFO names the game it belongs to; its first folder in name order is the one read.
async function pspSaveFacts(manifest, files, read) {
  const first = manifest.files.find((f) => /^[^/]+\/PARAM\.SFO$/i.test(f.path));
  if (!first) return facts(manifest.unit, "psp", null, { icon: null, cover: null, background: null });
  const folder = first.path.slice(0, first.path.indexOf("/") + 1).toLowerCase();
  const at = (name) => {
    const f = files.get(folder + name.toLowerCase());
    return f ? { file: f, offset: 0, length: f.size } : null;
  };
  const sfo = await readSfo({ file: first, offset: 0, length: first.size }, read);
  // The save's own title is the save's ("Slot 1"); the game's is SAVEDATA_TITLE when it has one.
  const named = sfo ? { ...sfo, TITLE: sfo.SAVEDATA_TITLE || sfo.TITLE, DISC_ID: undefined } : null;
  return facts(manifest.unit, "psp", named, { icon: at("ICON0.PNG"), cover: at("PIC1.PNG"), background: at("PIC1.PNG") });
}

// EBOOT.PBP: "\0PBP", a version, then eight offsets: PARAM.SFO, ICON0.PNG, ICON1.PMF, PIC0.PNG, PIC1.PNG, SND0.AT3,
// DATA.PSP, DATA.PSAR. Each section runs to the next one's offset.
async function pbpFacts(manifest, eboot, read) {
  const head = await read(eboot, 0, 40);
  if (head.length < 40 || head.readUInt32LE(0) !== 0x50425000) return facts(manifest.unit, "psp", null, { icon: null, cover: null, background: null });
  const offs = Array.from({ length: 8 }, (_, i) => head.readUInt32LE(8 + i * 4));
  const section = (i) => {
    const offset = offs[i];
    const end = i < 7 ? offs[i + 1] : eboot.size;
    return offset >= 40 && end > offset && end <= eboot.size ? { file: eboot, offset, length: end - offset } : null;
  };
  const sfo = await readSfo(section(0), read);
  return facts(manifest.unit, "psp", sfo, { icon: section(1), cover: section(4), background: section(4) });
}

// An uncompressed PSP disc image: PSP_GAME/PARAM.SFO and its pictures, found through the ISO 9660 directories.
async function isoFacts(manifest, read) {
  const disc = manifest.files[0];
  const none = { icon: null, cover: null, background: null };
  const name = disc.path.replace(/\.(iso|cso)$/i, "");
  const named = { ...facts(manifest.unit, "psp", null, none), titleId: null, title: clean(name) };
  if (!/\.iso$/i.test(disc.path)) return named;
  const pvd = await read(disc, 16 * SECTOR, SECTOR);
  if (pvd.length < SECTOR || pvd[0] !== 1 || pvd.toString("latin1", 1, 6) !== "CD001") return named;
  const root = { lba: pvd.readUInt32LE(156 + 2), size: pvd.readUInt32LE(156 + 10) };
  const game = await isoEntry(disc, root, "PSP_GAME", read);
  const file = async (n) => {
    const e = game?.dir ? await isoEntry(disc, game, n, read) : null;
    return e && !e.dir ? { file: disc, offset: e.lba * SECTOR, length: e.size } : null;
  };
  const sfo = await readSfo(await file("PARAM.SFO"), read);
  const out = facts(manifest.unit, "psp", sfo, { icon: await file("ICON0.PNG"), cover: await file("PIC1.PNG"), background: await file("PIC1.PNG") });
  return { ...out, title: out.title ?? clean(name), titleId: sfo?.DISC_ID ? out.titleId : null };
}

async function isoEntry(disc, dir, want, read) {
  if (dir.size > DIR_MAX || dir.lba * SECTOR + dir.size > disc.size) return null;
  const data = await read(disc, dir.lba * SECTOR, dir.size);
  for (let at = 0; at < data.length;) {
    const len = data[at];
    // A record never crosses a sector: a zero length means the rest of this sector is padding.
    if (!len) {
      at = (Math.floor(at / SECTOR) + 1) * SECTOR;
      continue;
    }
    if (at + 33 > data.length || at + len > data.length) break;
    const nameLen = data[at + 32];
    const name = data.toString("latin1", at + 33, at + 33 + nameLen).replace(/;1$/, "").replace(/\.$/, "");
    if (name.toUpperCase() === want) return { lba: data.readUInt32LE(at + 2), size: data.readUInt32LE(at + 10), dir: Boolean(data[at + 25] & 2) };
    at += len;
  }
  return null;
}
