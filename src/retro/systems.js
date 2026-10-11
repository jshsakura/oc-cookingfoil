/**
 * The consoles CookingFoil knows how to hand to RetroArch on the Switch.
 *
 *   id          English key, also the folder name under roms/, bezels/, icons/
 *   names       labels in the four shop languages
 *   extensions  ROM files listed for the system (lower case, with the dot)
 *   core        the Switch core file, retroarch/cores/<core>_libretro_libnx.nro
 *   coreName    the core's own name, which RetroArch uses for per-game
 *               configs: retroarch/config/<coreName>/<game>.cfg
 *   bezelDir    The Bezel Project's folder: overlays/GameBezels/<bezelDir>/
 *
 * An operator can change any of this, or add a system, with
 * <retro dir>/systems.json: { "<id>": { core, coreName, extensions, names, bezelDir } }.
 */
import fs from "fs";
import path from "path";
import debug from "../debug.js";

const DISC = [".chd", ".pbp", ".cue", ".m3u"];

export const DEFAULT_SYSTEMS = {
  nes: {
    names: { en: "Nintendo Entertainment System", ko: "패미컴 (NES)", ja: "ファミリーコンピュータ", zh: "红白机 (NES)" },
    extensions: [".nes", ".fds", ".zip", ".7z"], core: "fceumm", coreName: "FCEUmm", bezelDir: "NES",
  },
  snes: {
    names: { en: "Super Nintendo", ko: "슈퍼 패미컴 (SNES)", ja: "スーパーファミコン", zh: "超级任天堂 (SNES)" },
    extensions: [".sfc", ".smc", ".zip", ".7z"], core: "snes9x", coreName: "Snes9x", bezelDir: "SNES",
  },
  gb: {
    names: { en: "Game Boy", ko: "게임보이", ja: "ゲームボーイ", zh: "Game Boy" },
    extensions: [".gb", ".zip", ".7z"], core: "gambatte", coreName: "Gambatte", bezelDir: "GB",
  },
  gbc: {
    names: { en: "Game Boy Color", ko: "게임보이 컬러", ja: "ゲームボーイカラー", zh: "Game Boy Color" },
    extensions: [".gbc", ".zip", ".7z"], core: "gambatte", coreName: "Gambatte", bezelDir: "GBC",
  },
  gba: {
    names: { en: "Game Boy Advance", ko: "게임보이 어드밴스", ja: "ゲームボーイアドバンス", zh: "Game Boy Advance" },
    extensions: [".gba", ".zip", ".7z"], core: "mgba", coreName: "mGBA", bezelDir: "GBA",
  },
  n64: {
    names: { en: "Nintendo 64", ko: "닌텐도 64", ja: "NINTENDO64", zh: "任天堂 64" },
    extensions: [".n64", ".z64", ".v64", ".zip", ".7z"], core: "mupen64plus_next", coreName: "Mupen64Plus-Next", bezelDir: "N64",
  },
  md: {
    names: { en: "Mega Drive / Genesis", ko: "메가 드라이브", ja: "メガドライブ", zh: "世嘉 MD" },
    extensions: [".md", ".gen", ".smd", ".bin", ".zip", ".7z"], core: "genesis_plus_gx", coreName: "Genesis Plus GX", bezelDir: "MegaDrive",
  },
  sms: {
    names: { en: "Master System", ko: "마스터 시스템", ja: "マスターシステム", zh: "世嘉 Master System" },
    extensions: [".sms", ".zip", ".7z"], core: "genesis_plus_gx", coreName: "Genesis Plus GX", bezelDir: "MasterSystem",
  },
  gg: {
    names: { en: "Game Gear", ko: "게임 기어", ja: "ゲームギア", zh: "Game Gear" },
    extensions: [".gg", ".zip", ".7z"], core: "genesis_plus_gx", coreName: "Genesis Plus GX", bezelDir: "GameGear",
  },
  pce: {
    names: { en: "PC Engine / TurboGrafx-16", ko: "PC 엔진", ja: "PCエンジン", zh: "PC Engine" },
    extensions: [".pce", ".zip", ".7z"], core: "mednafen_pce_fast", coreName: "Beetle PCE Fast", bezelDir: "PCEngine",
  },
  ps1: {
    names: { en: "PlayStation", ko: "플레이스테이션", ja: "プレイステーション", zh: "PlayStation" },
    extensions: DISC, core: "pcsx_rearmed", coreName: "PCSX-ReARMed", bezelDir: "PSX",
  },
  arcade: {
    names: { en: "Arcade", ko: "아케이드", ja: "アーケード", zh: "街机" },
    extensions: [".zip", ".7z"], core: "fbneo", coreName: "FinalBurn Neo", bezelDir: "MAME",
  },
};

const ID_RE = /^[a-z0-9_-]{1,24}$/;

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
    const base = out[id] ?? { names: { en: id }, extensions: [], core: "", coreName: "", bezelDir: id };
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
    };
  }
  return out;
}
