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
 *               system-icons/{color,mono}/<folder>.png. The id unless an
 *               operator names another.
 *   libretro    the libretro database name ("Nintendo - Game Boy Advance"). Only
 *               the art code reads it, to find the libretro-thumbnails repository
 *               box art comes from; it is a mapping, never a folder name.
 *
 * Each system is read from exactly one folder.
 *
 * An operator can change any of this, or add a system, with
 * <retro dir>/systems.json: { "<id>": { core, coreName, extensions, names, bezelDir, folder, libretro } }.
 */
import fs from "fs";
import path from "path";
import debug from "../debug.js";

const DISC = [".chd", ".pbp", ".cue", ".m3u"];

const SYSTEMS = {
  nes: {
    names: { en: "Nintendo Entertainment System", ko: "패미컴 (NES)", ja: "ファミリーコンピュータ", zh: "红白机 (NES)" },
    extensions: [".nes", ".fds", ".zip", ".7z"], core: "fceumm", coreName: "FCEUmm", bezelDir: "NES",
    libretro: "Nintendo - Nintendo Entertainment System",
  },
  snes: {
    names: { en: "Super Nintendo", ko: "슈퍼 패미컴 (SNES)", ja: "スーパーファミコン", zh: "超级任天堂 (SNES)" },
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
    names: { en: "Arcade", ko: "아케이드", ja: "アーケード", zh: "街机" },
    extensions: [".zip", ".7z"], core: "fbneo", coreName: "FinalBurn Neo", bezelDir: "MAME",
    libretro: "FBNeo - Arcade Games",
  },
};


// A built-in system's folder is its id.
export const DEFAULT_SYSTEMS = Object.fromEntries(Object.entries(SYSTEMS).map(([id, s]) => [id, { ...s, folder: id }]));

const ID_RE = /^[a-z0-9_-]{1,24}$/;

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
  let custom;
  try {
    custom = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    if (err.code !== "ENOENT") debug.error("retro: ignoring %s: %s", file, err.message);
    return out;
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
  return out;
}
