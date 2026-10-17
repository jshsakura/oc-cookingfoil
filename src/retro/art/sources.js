/**
 * Where retro art comes from and how it is fetched:
 *
 *   box art   libretro-thumbnails, filed under the No-Intro / Redump name
 *   bezels    The Bezel Project, same names, Japanese collections first
 *
 * download() writes only real PNGs, following the short text files
 * libretro-thumbnails uses for Git symlinks.
 */
import fs from "fs";
import path from "path";

export const THUMBS = "https://raw.githubusercontent.com/libretro-thumbnails";
export const BEZELS = "https://raw.githubusercontent.com/thebezelproject";
export const CONCURRENCY = 6;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const MAX_LINK_HOPS = 3;

// Bezel Project collections per system, Japanese ones first: most translated
// games are Japanese originals. Each is [repo, GameBezels folder, default image].
export const BEZEL_SOURCES = {
  nes: [["bezelproject-Famicom", "Famicom", "Nintendo-Famicom"], ["bezelproject-NES", "NES", "Nintendo-Entertainment-System"]],
  snes: [["bezelproject-SFC", "SFC", "Nintendo-Super-Famicom"], ["bezelproject-SNES", "SNES", "Super-Nintendo-Entertainment-System"]],
  gb: [["bezelproject-GB", "GB", "Nintendo-Game-Boy"]],
  gbc: [["bezelproject-GBC", "GBC", "Nintendo-Game-Boy-Color"]],
  gba: [["bezelproject-GBA", "GBA", "Nintendo-Game-Boy-Advance"]],
  n64: [["bezelproject-N64", "N64", "Nintendo-64"]],
  nds: [["bezelproject-NDS", "NDS", "Nintendo-DS"]],
  md: [["bezelproject-MegaDrive", "MegaDrive", "Sega-Mega-Drive"]],
  sms: [["bezelproject-MasterSystem", "MasterSystem", "Sega-Master-System"]],
  gg: [["bezelproject-GameGear", "GameGear", "Sega-Game-Gear"]],
  pce: [["bezelproject-PCEngine", "PCEngine", "NEC-PC-Engine"]],
  ps1: [["bezelproject-PSX", "PSX", "Sony-PlayStation"]],
  segacd: [["bezelproject-SegaCD", "SegaCD", "Sega-CD"]],
  pcecd: [["bezelproject-PCE-CD", "PCE-CD", "NEC-PC-Engine-CD"]],
  saturn: [["bezelproject-Saturn", "Saturn", "Sega-Saturn"]],
  ngp: [["bezelproject-NGPC", "NGP", "SNK-Neo-Geo-Pocket-Color"]],
  ws: [["bezelproject-WonderSwanColor", "WonderSwanColor", "Bandai-WonderSwan—Color-Horizontal"]],
  arcade: [["bezelproject-MAME", "MAME", "MAME-Horizontal"]],
  neocd: [["bezelproject-NG-CD", "NG-CD", "SNK-Neo-Geo-CD"]],
  "32x": [["bezelproject-Sega32X", "Sega32X", "Sega-32X"]],
  sg: [["bezelproject-SG-1000", "SG-1000", "Sega-SG-1000"]],
  a2600: [["bezelproject-Atari2600", "Atari2600", "Atari-2600"]],
  a7800: [["bezelproject-Atari7800", "Atari7800", "Atari-7800"]],
  lynx: [["bezelproject-AtariLynx", "AtariLynx", "Atari-Lynx-Horizontal"]],
  col: [["bezelproject-ColecoVision", "ColecoVision", "Colecovision"]],
  videopac: [["bezelproject-Videopac", "Videopac", "Magnavox-Odyssey-2"]],
  msx: [["bezelproject-MSX", "MSX", "Microsoft-MSX"]],
  amstrad: [["bezelproject-AmstradCPC", "AmstradCPC", "Amstrad-CPC"]],
  c64: [["bezelproject-C64", "C64", "Commodore-64"]],
  zxs: [["bezelproject-ZXSpectrum", "ZXSpectrum", "Sinclair-ZX-Spectrum"]],
  vb: [["bezelproject-Virtualboy", "Virtualboy", "Nintendo-Virtual-Boy"]],
  wsv: [["bezelproject-Supervision", "Supervision", "Watara-Supervision"]],
  // ScummVM: bezels are filed under the game's ScummVM id, not under its libretro title (see targetNames in sync.js).
  scummvm: [["bezelproject-ScummVM", "ScummVM", "ScummVM"]],
  // psp: none. Its 16:9 screen fills the console's, so there is nothing to frame.
  // pico8, chip8, tama: The Bezel Project has no collection for them.
};

export const enc = (p) => p.split("/").map(encodeURIComponent).join("/");
/** The libretro-thumbnails repo for a database name; null for a system libretro has no box art for. Pure. */
export const repoOf = (libretro) => (libretro ? libretro.replaceAll(" ", "_") : null);

/**
 * Download a PNG. libretro-thumbnails stores some covers as Git symlinks, which
 * raw.githubusercontent.com serves as a short text file holding the target's
 * name; those are followed (within the same folder). Anything that isn't a PNG
 * is never written.
 */
/** Fetches a PNG (following libretro's link files) into dest; `transform` reshapes the bytes first. */
export async function download(url, dest, dry, transform = null) {
  if (dry) return "dry";
  let current = url;
  for (let hop = 0; hop <= MAX_LINK_HOPS; hop++) {
    const res = await fetch(current);
    if (res.status === 404) return "missing";
    if (!res.ok) throw new Error(`${res.status} ${current}`);
    const body = Buffer.from(await res.arrayBuffer());
    if (body.subarray(0, 4).equals(PNG_MAGIC)) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const tmp = `${dest}.part`;
      // A PNG the transform can't read is kept as it came, rather than lost.
      fs.writeFileSync(tmp, transform ? await transform(body).catch(() => body) : body);
      fs.renameSync(tmp, dest);
      return "ok";
    }
    const target = body.length < 512 ? body.toString("utf8").trim() : "";
    if (!target.endsWith(".png") || target.includes("..")) return "not-png";
    current = new URL(target.split("/").map(encodeURIComponent).join("/"), current).href;
  }
  return "not-png";
}

/** Try each URL in turn until one exists. */
export async function firstOf(urls, dest, dry) {
  for (const url of urls) {
    const r = await download(url, dest, dry);
    if (r !== "missing") return r;
  }
  return "missing";
}

/** Runs jobs CONCURRENCY at a time; a job that throws yields "error: …". */
export async function pool(jobs) {
  const results = [];
  let next = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (next < jobs.length) {
      const i = next++;
      try {
        results[i] = await jobs[i]();
      } catch (err) {
        results[i] = `error: ${err.message}`;
      }
    }
  }));
  return results;
}

const TREES = "https://api.github.com/repos/libretro-thumbnails";

/** Box art names (without .png) in one libretro-thumbnails repo. `token` lifts GitHub's anonymous limit. */
export async function boxartNames(repo, { token = "", fetchImpl = fetch } = {}) {
  const gh = async (url) => {
    const res = await fetchImpl(url, { headers: { Accept: "application/vnd.github+json", "User-Agent": "oc-cookingfoil", ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
    if (!res.ok) throw new Error(`GitHub ${res.status} ${url}`);
    return res.json();
  };
  const root = await gh(`${TREES}/${repo}/git/trees/HEAD`);
  const dir = root.tree.find((t) => t.path === "Named_Boxarts");
  if (!dir) return [];
  const tree = await gh(`${TREES}/${repo}/git/trees/${dir.sha}`);
  return tree.tree.filter((t) => t.path.endsWith(".png")).map((t) => t.path.slice(0, -4));
}
