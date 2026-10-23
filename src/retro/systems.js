/**
 * The consoles CookingFoil knows how to hand to RetroArch on the Switch.
 *
 *   id          English key and short slug (nes, snes, ps1, arcade, …); also the
 *               console's folder on the SD card: roms/<id>/
 *   names       labels in the four shop languages
 *   extensions  ROM files listed for the system (lower case, with the dot)
 *   core        the Switch core file, retroarch/cores/<core>_libretro_libnx.nro
 *   coreName    the core's own name, which RetroArch uses for per-game
 *               configs: retroarch/config/<coreName>/<game>.cfg
 *   bezelDir    The Bezel Project's folder: overlays/GameBezels/<bezelDir>/
 *   folder      the system's one folder on the server: roms/<folder>/,
 *               thumbnails/<folder>/, bezels/<folder>/, icons/<folder>/ and
 *               system-icons/{color,mono}/<folder>.png (or <id>.png). The id,
 *               or RetroArch's system name ("Atari - 2600") for the systems
 *               added later, unless an operator names another. It may hold
 *               spaces and dots; it never reaches the SD card.
 *   libretro    the libretro database name ("Nintendo - Game Boy Advance"). Only
 *               the art code reads it, to find the libretro-thumbnails repository
 *               box art comes from; it is a mapping, never a folder name. Left
 *               out for systems libretro has no box art for.
 *
 * Each system is read from exactly one folder. When its own folder is not
 * under roms/, a folder named the way other front ends name it (SNES, psx,
 * genesis, "Nintendo - Game Boy Advance", …) is read instead; anything else in
 * roms/ is reported unread on the admin page.
 *
 * An operator can change any of this, or add a system, with
 * <retro dir>/systems.json: { "<id>": { core, coreName, extensions, names, bezelDir, folder, libretro } }.
 */
import fs from "fs";
import path from "path";
import debug from "../debug.js";
import { isReadme } from "../helpers/readme-name.js";

const DISC = [".chd", ".pbp", ".cue", ".m3u"];

const SYSTEMS = {
  nes: {
    names: { en: "Nintendo Entertainment System", ko: "패미컴 (NES)", ja: "ファミリーコンピュータ", zh: "红白机 (NES)", "zh-Hant": "紅白機 (NES)" },
    extensions: [".nes", ".fds", ".zip", ".7z"], core: "fceumm", coreName: "FCEUmm", bezelDir: "NES",
    libretro: "Nintendo - Nintendo Entertainment System",
  },
  snes: {
    names: { en: "Super Nintendo", ko: "슈퍼 패미컴 (SNES)", ja: "スーパーファミコン", zh: "超级任天堂 (SNES)", "zh-Hant": "超級任天堂 (SNES)" },
    extensions: [".sfc", ".smc", ".zip", ".7z"], core: "snes9x", coreName: "Snes9x", bezelDir: "SNES",
    libretro: "Nintendo - Super Nintendo Entertainment System",
  },
  gb: {
    names: { en: "Game Boy", ko: "게임보이", ja: "ゲームボーイ", zh: "Game Boy" },
    extensions: [".gb", ".zip", ".7z"], core: "gambatte", coreName: "Gambatte", bezelDir: "GB",
    libretro: "Nintendo - Game Boy",
  },
  gbc: {
    names: { en: "Game Boy Color", ko: "게임보이 컬러", ja: "ゲームボーイカラー", zh: "Game Boy Color" },
    extensions: [".gbc", ".zip", ".7z"], core: "gambatte", coreName: "Gambatte", bezelDir: "GBC",
    libretro: "Nintendo - Game Boy Color",
  },
  gba: {
    names: { en: "Game Boy Advance", ko: "게임보이 어드밴스", ja: "ゲームボーイアドバンス", zh: "Game Boy Advance" },
    extensions: [".gba", ".zip", ".7z"], core: "mgba", coreName: "mGBA", bezelDir: "GBA",
    libretro: "Nintendo - Game Boy Advance",
  },
  n64: {
    names: { en: "Nintendo 64", ko: "닌텐도 64", ja: "NINTENDO64", zh: "任天堂 64" },
    extensions: [".n64", ".z64", ".v64", ".zip", ".7z"], core: "mupen64plus_next", coreName: "Mupen64Plus-Next", bezelDir: "N64",
    libretro: "Nintendo - Nintendo 64",
  },
  md: {
    names: { en: "Mega Drive / Genesis", ko: "메가 드라이브", ja: "メガドライブ", zh: "世嘉 MD" },
    extensions: [".md", ".gen", ".smd", ".bin", ".zip", ".7z"], core: "genesis_plus_gx", coreName: "Genesis Plus GX", bezelDir: "MegaDrive",
    libretro: "Sega - Mega Drive - Genesis",
  },
  sms: {
    names: { en: "Master System", ko: "마스터 시스템", ja: "マスターシステム", zh: "世嘉 Master System" },
    extensions: [".sms", ".zip", ".7z"], core: "genesis_plus_gx", coreName: "Genesis Plus GX", bezelDir: "MasterSystem",
    libretro: "Sega - Master System - Mark III",
  },
  gg: {
    names: { en: "Game Gear", ko: "게임 기어", ja: "ゲームギア", zh: "Game Gear" },
    extensions: [".gg", ".zip", ".7z"], core: "genesis_plus_gx", coreName: "Genesis Plus GX", bezelDir: "GameGear",
    libretro: "Sega - Game Gear",
  },
  pce: {
    names: { en: "PC Engine / TurboGrafx-16", ko: "PC 엔진", ja: "PCエンジン", zh: "PC Engine" },
    extensions: [".pce", ".zip", ".7z"], core: "mednafen_pce_fast", coreName: "Beetle PCE Fast", bezelDir: "PCEngine",
    libretro: "NEC - PC Engine - TurboGrafx 16",
  },
  segacd: {
    names: { en: "Sega CD / Mega-CD", ko: "메가 CD", ja: "メガCD", zh: "世嘉 Mega-CD" },
    extensions: [".chd", ".cue", ".m3u", ".iso"], core: "genesis_plus_gx", coreName: "Genesis Plus GX", bezelDir: "SegaCD",
    libretro: "Sega - Mega-CD - Sega CD",
  },
  pcecd: {
    names: { en: "PC Engine CD / TurboGrafx-CD", ko: "PC 엔진 CD", ja: "PCエンジン CD-ROM²", zh: "PC Engine CD" },
    extensions: [".chd", ".cue", ".m3u", ".ccd"], core: "mednafen_pce_fast", coreName: "Beetle PCE Fast", bezelDir: "PCE-CD",
    libretro: "NEC - PC Engine CD - TurboGrafx-CD",
  },
  ps1: {
    names: { en: "PlayStation", ko: "플레이스테이션", ja: "プレイステーション", zh: "PlayStation" },
    extensions: DISC, core: "pcsx_rearmed", coreName: "PCSX-ReARMed", bezelDir: "PSX",
    libretro: "Sony - PlayStation",
  },
  psp: {
    names: { en: "PlayStation Portable", ko: "플레이스테이션 포터블 (PSP)", ja: "プレイステーション・ポータブル", zh: "PSP" },
    extensions: [".iso", ".cso", ".pbp", ".chd"], core: "ppsspp", coreName: "PPSSPP", bezelDir: "PSP",
    libretro: "Sony - PlayStation Portable",
  },
  nds: {
    names: { en: "Nintendo DS", ko: "닌텐도 DS", ja: "ニンテンドーDS", zh: "任天堂 DS" },
    extensions: [".nds", ".zip", ".7z"], core: "melonds", coreName: "melonDS", bezelDir: "NDS",
    libretro: "Nintendo - Nintendo DS",
  },
  ngp: {
    names: { en: "Neo Geo Pocket", ko: "네오지오 포켓", ja: "ネオジオポケット", zh: "Neo Geo Pocket" },
    extensions: [".ngp", ".ngc", ".zip", ".7z"], core: "mednafen_ngp", coreName: "Beetle NeoPop", bezelDir: "NGPC",
    libretro: "SNK - Neo Geo Pocket Color",
  },
  ws: {
    names: { en: "WonderSwan", ko: "원더스완", ja: "ワンダースワン", zh: "WonderSwan" },
    extensions: [".ws", ".wsc", ".zip", ".7z"], core: "mednafen_wswan", coreName: "Beetle WonderSwan", bezelDir: "WonderSwanColor",
    libretro: "Bandai - WonderSwan Color",
  },
  saturn: {
    names: { en: "Sega Saturn", ko: "세가 새턴", ja: "セガサターン", zh: "世嘉土星" },
    extensions: [".chd", ".cue", ".m3u"], core: "yabause", coreName: "Yabause", bezelDir: "Saturn",
    libretro: "Sega - Saturn",
  },
  arcade: {
    names: { en: "Arcade", ko: "아케이드", ja: "アーケード", zh: "街机", "zh-Hant": "街機", ru: "Аркада" },
    extensions: [".zip", ".7z"], core: "fbneo", coreName: "FinalBurn Neo", bezelDir: "MAME",
    libretro: "FBNeo - Arcade Games",
  },
  // Pre-registered: each one shows up (lists, home, menus, BIOS notices) only
  // once roms/<folder>/ holds a game. Their server folder is RetroArch's own
  // system name; the SD card keeps the short id.
  neocd: {
    names: { en: "Neo Geo CD", ko: "네오지오 CD", ja: "ネオジオCD", zh: "Neo Geo CD" },
    extensions: [".chd", ".cue"], core: "neocd", coreName: "NeoCD", bezelDir: "NG-CD",
    folder: "SNK - Neo Geo CD", libretro: "SNK - Neo Geo CD",
  },
  "32x": {
    names: { en: "Sega 32X", ko: "슈퍼 32X", ja: "スーパー32X", zh: "世嘉 32X" },
    extensions: [".32x", ".zip", ".7z"], core: "picodrive", coreName: "PicoDrive", bezelDir: "Sega32X",
    folder: "Sega - 32X", libretro: "Sega - 32X",
  },
  sg: {
    names: { en: "SG-1000", ko: "SG-1000", ja: "SG-1000", zh: "世嘉 SG-1000" },
    extensions: [".sg", ".zip", ".7z"], core: "genesis_plus_gx", coreName: "Genesis Plus GX", bezelDir: "SG-1000",
    folder: "Sega - SG-1000", libretro: "Sega - SG-1000",
  },
  a2600: {
    names: { en: "Atari 2600", ko: "아타리 2600", ja: "アタリ2600", zh: "雅达利 2600", "zh-Hant": "雅達利 2600" },
    extensions: [".a26", ".bin", ".zip", ".7z"], core: "stella", coreName: "Stella", bezelDir: "Atari2600",
    folder: "Atari - 2600", libretro: "Atari - 2600",
  },
  a7800: {
    names: { en: "Atari 7800", ko: "아타리 7800", ja: "アタリ7800", zh: "雅达利 7800", "zh-Hant": "雅達利 7800" },
    extensions: [".a78", ".bin", ".zip", ".7z"], core: "prosystem", coreName: "ProSystem", bezelDir: "Atari7800",
    folder: "Atari - 7800", libretro: "Atari - 7800",
  },
  lynx: {
    names: { en: "Atari Lynx", ko: "아타리 링크스", ja: "アタリ リンクス", zh: "雅达利 Lynx", "zh-Hant": "雅達利 Lynx" },
    extensions: [".lnx", ".lyx", ".zip", ".7z"], core: "handy", coreName: "Handy", bezelDir: "AtariLynx",
    folder: "Atari - Lynx", libretro: "Atari - Lynx",
  },
  col: {
    names: { en: "ColecoVision", ko: "콜레코비전", ja: "コレコビジョン", zh: "ColecoVision" },
    extensions: [".col", ".cv", ".zip", ".7z"], core: "gearcoleco", coreName: "Gearcoleco", bezelDir: "ColecoVision",
    folder: "Coleco - ColecoVision", libretro: "Coleco - ColecoVision",
  },
  videopac: {
    names: { en: "Odyssey² / Videopac", ko: "오디세이² / 비디오팩", ja: "オデッセイ² / ビデオパック", zh: "Odyssey² / Videopac" },
    extensions: [".bin", ".zip", ".7z"], core: "o2em", coreName: "O2EM", bezelDir: "Videopac",
    folder: "Magnavox - Odyssey2", libretro: "Magnavox - Odyssey2",
  },
  msx: {
    names: { en: "MSX", ko: "MSX", ja: "MSX", zh: "MSX" },
    extensions: [".rom", ".mx1", ".mx2", ".dsk", ".cas", ".zip", ".7z"], core: "bluemsx", coreName: "blueMSX", bezelDir: "MSX",
    folder: "Microsoft - MSX", libretro: "Microsoft - MSX",
  },
  amstrad: {
    names: { en: "Amstrad CPC", ko: "암스트래드 CPC", ja: "アムストラッドCPC", zh: "Amstrad CPC" },
    extensions: [".dsk", ".sna", ".cdt", ".tap", ".cpr", ".m3u", ".zip"], core: "cap32", coreName: "Caprice32", bezelDir: "AmstradCPC",
    folder: "Amstrad - CPC", libretro: "Amstrad - CPC",
  },
  c64: {
    names: { en: "Commodore 64", ko: "코모도어 64", ja: "コモドール64", zh: "Commodore 64" },
    extensions: [".d64", ".t64", ".tap", ".prg", ".crt", ".g64", ".m3u", ".zip"], core: "vice_x64", coreName: "VICE x64", bezelDir: "C64",
    folder: "Commodore - 64", libretro: "Commodore - 64",
  },
  zxs: {
    names: { en: "ZX Spectrum", ko: "ZX 스펙트럼", ja: "ZXスペクトラム", zh: "ZX Spectrum" },
    extensions: [".tzx", ".tap", ".z80", ".sna", ".szx", ".dsk", ".trd", ".scl", ".zip"], core: "fuse", coreName: "Fuse", bezelDir: "ZXSpectrum",
    folder: "Sinclair - ZX Spectrum", libretro: "Sinclair - ZX Spectrum",
  },
  vb: {
    names: { en: "Virtual Boy", ko: "버추얼 보이", ja: "バーチャルボーイ", zh: "Virtual Boy" },
    extensions: [".vb", ".vboy", ".zip", ".7z"], core: "mednafen_vb", coreName: "Beetle VB", bezelDir: "Virtualboy",
    folder: "Nintendo - Virtual Boy", libretro: "Nintendo - Virtual Boy",
  },
  wsv: {
    names: { en: "Watara Supervision", ko: "와타라 슈퍼비전", ja: "ワタラ スーパービジョン", zh: "Watara Supervision" },
    extensions: [".sv", ".bin", ".zip", ".7z"], core: "potator", coreName: "Potator", bezelDir: "Supervision",
    folder: "Watara - Supervision", libretro: "Watara - Supervision",
  },
  mini: {
    names: { en: "Pokémon mini", ko: "포켓몬 미니", ja: "ポケモンミニ", zh: "宝可梦 mini" },
    extensions: [".min", ".zip", ".7z"], core: "pokemini", coreName: "PokeMini", bezelDir: "PokemonMini",
    folder: "Nintendo - Pokemon Mini", libretro: "Nintendo - Pokemon Mini",
  },
  gw: {
    names: { en: "Game & Watch", ko: "게임 & 워치", ja: "ゲーム&ウオッチ", zh: "Game & Watch" },
    extensions: [".mgw", ".zip", ".7z"], core: "gw", coreName: "Game & Watch", bezelDir: "GameAndWatch",
    folder: "Nintendo - Game & Watch", libretro: "Handheld Electronic Game",
  },
  // The three below have neither a Bezel Project collection nor libretro box
  // art, so they carry no bezelDir (the SD folder falls back to the id) or libretro.
  pico8: {
    names: { en: "PICO-8", ko: "PICO-8", ja: "PICO-8", zh: "PICO-8" },
    extensions: [".p8", ".png"], core: "retro8", coreName: "Retro8", folder: "PICO-8",
  },
  chip8: {
    names: { en: "CHIP-8", ko: "CHIP-8", ja: "CHIP-8", zh: "CHIP-8" },
    extensions: [".ch8", ".sc8", ".xo8"], core: "jaxe", coreName: "JAXE", folder: "CHIP-8",
  },
  tama: {
    names: { en: "Tamagotchi", ko: "다마고치", ja: "たまごっち", zh: "拓麻歌子" },
    extensions: [".b", ".bin"], core: "tamalibretro", coreName: "TamaLIBretro", folder: "Bandai - Tamagotchi P1",
  },
  // A ScummVM game is a folder of the original game's files with a small
  // <name>.scummvm file in it; the whole folder goes to the console (catalog.js).
  scummvm: {
    names: { en: "ScummVM", ko: "ScummVM (어드벤처)", ja: "ScummVM", zh: "ScummVM" },
    extensions: [".scummvm"], core: "scummvm", coreName: "ScummVM", bezelDir: "ScummVM", folder: "ScummVM",
    libretro: "ScummVM",
  },
  // OpenBOR runs a game's .pak on the OpenBOR libretro core. No official libnx build exists, so
  // the core file is the operator's own build in retroarch/cores/ (the pack fill never brings it).
  openbor: {
    names: { en: "OpenBOR", ko: "OpenBOR (벨트스크롤)", ja: "OpenBOR", zh: "OpenBOR" },
    extensions: [".pak"], core: "openbor", coreName: "OpenBOR",
  },
};


// A built-in system's folder is its id unless it names one; without a Bezel
// Project folder its SD overlay folder is the id too.
export const DEFAULT_SYSTEMS = Object.fromEntries(Object.entries(SYSTEMS).map(([id, s]) => [id, { ...s, bezelDir: s.bezelDir ?? id, folder: s.folder ?? id }]));

const ID_RE = /^[a-z0-9_-]{1,24}$/;

// Folder names other front ends (ES-DE, Batocera, RetroArch playlists) give a system,
// besides its id, its folder, its libretro name and its English name.
const FOLDER_ALIASES = {
  nes: ["famicom", "fc"], snes: ["sfc", "superfamicom", "supernes"], gb: ["gameboy"], gbc: ["gameboycolor"],
  gba: ["gameboyadvance"], n64: ["nintendo64"], md: ["megadrive", "genesis", "segagenesis", "segamegadrive"],
  sms: ["mastersystem", "segamastersystem"], gg: ["gamegear", "segagamegear"],
  pce: ["pcengine", "tg16", "turbografx16", "turbografx"], segacd: ["megacd", "segamegacd"],
  pcecd: ["pcenginecd", "tgcd", "turbografxcd"], ps1: ["psx", "playstation", "sonyplaystation"],
  psp: ["playstationportable", "sonyplaystationportable"], nds: ["ds", "nintendods"],
  ngp: ["ngpc", "neogeopocket", "neogeopocketcolor"], ws: ["wonderswan", "wonderswancolor", "wsc"],
  saturn: ["segasaturn"], arcade: ["fbneo", "fba", "finalburnneo"], neocd: ["neogeocd"], "32x": ["sega32x"],
  sg: ["sg1000"], a2600: ["atari2600"], a7800: ["atari7800"], lynx: ["atarilynx"], col: ["colecovision", "coleco"],
  videopac: ["odyssey2", "videopac"], msx: ["msx1", "msx2"], amstrad: ["amstradcpc", "cpc"], c64: ["commodore64"],
  zxs: ["zxspectrum"], vb: ["virtualboy"], wsv: ["supervision"], tama: ["tamagotchi"],
  mini: ["pokemini", "pokemonmini"], gw: ["gameandwatch", "gamewatch", "handheldelectronicgame"],
};

/** A folder name compared without case, spaces or punctuation ("Nintendo - SNES" → "nintendosnes"). Pure. */
const keyOf = (name) => String(name ?? "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/** The folder names a built-in system answers to, compared as keys. Pure. */
export function folderKeys(id, s) {
  return [...new Set([id, s.folder, s.libretro, s.names?.en, ...(FOLDER_ALIASES[id] ?? [])].filter(Boolean).map(keyOf))];
}

/** The visible folders directly under <retroDir>/roms. */
function romFolders(retroDir) {
  try {
    return fs.readdirSync(path.join(retroDir, "roms"), { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name).sort();
  } catch {
    return [];
  }
}

/** The id of the system a folder name stands for (its folder, or a look-alike of a built-in one), or null. Pure. */
export function systemOfFolder(name, systems) {
  const k = keyOf(name);
  if (!k) return null;
  for (const [id, s] of Object.entries(systems)) {
    if (keyOf(s.folder) === k || folderKeys(id, DEFAULT_SYSTEMS[id] ?? s).includes(k)) return id;
  }
  return null;
}

/** The id of the one system that plays files with this extension, or null when none or several do. Pure. */
export function systemOfExtension(ext, systems) {
  const hits = Object.entries(systems).filter(([, s]) => s.extensions.includes(String(ext).toLowerCase()));
  return hits.length === 1 ? hits[0][0] : null;
}

// What an OS leaves in a folder it has shown (dot files such as .DS_Store aside): never a game. Nor is a README.md.
const OS_LITTER = new Set(["thumbs.db", "desktop.ini", "ehthumbs.db"]);

/** Whether roms/<folder> holds anything but dot files and OS litter; reads only up to the first such entry. */
function hasEntries(retroDir, folder) {
  let dir;
  try {
    dir = fs.opendirSync(path.join(retroDir, "roms", folder));
    for (let e = dir.readSync(); e; e = dir.readSync()) {
      if (!e.name.startsWith(".") && !OS_LITTER.has(e.name.toLowerCase()) && !isReadme(e.name)) return true;
    }
    return false;
  } catch {
    return false;
  } finally {
    dir?.closeSync();
  }
}

/**
 * Folders under roms/ that no system reads, each with why: { folder, system, by }. `system` and `by` are set
 * when the folder is a look-alike of a system whose read folder `by` already holds files (withFoundFolders
 * keeps that one); both are null when no system answers to the name. A built-in system's own folder left
 * empty for a look-alike is not listed.
 */
export function unreadReasons(retroDir, systems) {
  const read = new Set(Object.values(systems).map((s) => s.folder));
  const own = new Set(Object.values(DEFAULT_SYSTEMS).map((s) => s.folder));
  return romFolders(retroDir)
    .filter((f) => !read.has(f) && !(own.has(f) && !hasEntries(retroDir, f)))
    .map((folder) => {
      const system = systemOfFolder(folder, systems);
      const by = system ? systems[system].folder : null;
      return by && by !== folder && hasEntries(retroDir, by) ? { folder, system, by } : { folder, system: null, by: null };
    });
}

/** Folders under roms/ that no system reads, by name (unreadReasons without the reasons). */
export const unreadFolders = (retroDir, systems) => unreadReasons(retroDir, systems).map((r) => r.folder);

/** A folder name an operator gave, or null when it isn't one plain name. Pure. */
export function folderName(value) {
  if (typeof value !== "string") return null;
  const name = value.trim();
  return name && name !== "." && name !== ".." && !/[\\/\0]/.test(name) ? name : null;
}

/** The default table with <retroDir>/systems.json laid over it. */
export function loadSystems(retroDir) {
  const out = structuredClone(DEFAULT_SYSTEMS);
  const file = path.join(retroDir, "systems.json");
  let custom = {};
  try {
    custom = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    if (err.code !== "ENOENT") debug.error("retro: ignoring %s: %s", file, err.message);
  }
  for (const [id, raw] of Object.entries(custom ?? {})) {
    if (!ID_RE.test(id) || typeof raw !== "object" || raw === null) continue;
    const base = out[id] ?? { names: { en: id }, extensions: [], core: "", coreName: "", bezelDir: id, folder: id, libretro: id };
    const extensions = Array.isArray(raw.extensions)
      ? raw.extensions.filter((e) => typeof e === "string").map((e) => (e.startsWith(".") ? e : `.${e}`).toLowerCase())
      : base.extensions;
    const text = (v, fallback) => (typeof v === "string" && v.trim() ? v.trim() : fallback);
    out[id] = {
      names: { ...base.names, ...(typeof raw.names === "object" && raw.names ? raw.names : {}) },
      extensions,
      core: text(raw.core, base.core),
      coreName: text(raw.coreName, base.coreName),
      bezelDir: text(raw.bezelDir, base.bezelDir),
      folder: folderName(raw.folder) ?? base.folder,
      libretro: text(raw.libretro, base.libretro),
    };
  }
  const named = new Set(Object.keys(custom ?? {}).filter((id) => folderName(custom[id]?.folder)));
  return withFoundFolders(out, romFolders(retroDir), named, (f) => hasEntries(retroDir, f));
}

/**
 * Each built-in system whose folder is missing takes the first look-alike folder no other system reads.
 * So does one whose folder is empty (`filled` says it holds nothing but dot files) while a look-alike holds
 * something: the server makes the empty folders (scaffold.js) before people copy in a collection named the
 * way other front ends name it. When both hold files the system's own folder wins, as it always has, so a
 * server whose own folder has games reads the same folder as before. Game ids hang on the system id and the
 * path inside the folder, not the folder's name, so they stay what that folder alone would give.
 */
function withFoundFolders(systems, folders, named, filled) {
  const taken = new Set(Object.values(systems).map((s) => s.folder).filter((f) => folders.includes(f)));
  const out = { ...systems };
  for (const [id, s] of Object.entries(systems)) {
    if (named.has(id) || !DEFAULT_SYSTEMS[id]) continue;
    const own = folders.includes(s.folder);
    const keys = new Set(folderKeys(id, DEFAULT_SYSTEMS[id]));
    const found = folders.find((f) => f !== s.folder && !taken.has(f) && keys.has(keyOf(f)) && (!own || filled(f)));
    if (!found || (own && filled(s.folder))) continue;
    taken.add(found);
    out[id] = { ...s, folder: found };
  }
  return out;
}
