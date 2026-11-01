/**
 * Which core to play each console's games with on the Switch, and why: the admin page shows it beside
 * each console's core picker. `pick` is the core we recommend; `alts` are other cores the libretro
 * nightly buildbot builds for the Switch (libnx) that are worth switching to for a reason given.
 * Every core named here is in that buildbot's list (test/unit/core-advice.test.js holds the list as read
 * on 2026-11-01), except where `separate` says the core has to come another way.
 *
 * The reasons are in core-advice-words.js: <system> for the pick, <system>.<core> for an alternative.
 * The advice is ours and says so on the page: a console keeps whatever core the admin picked.
 */
import { CORE_ADVICE_WORDS } from "./core-advice-words.js";

export const CORE_ADVICE = {
  nes: { pick: "fceumm", alts: ["mesen", "nestopia"] },
  snes: { pick: "snes9x", alts: ["snes9x2010", "bsnes"] },
  gb: { pick: "gambatte", alts: ["sameboy", "mgba"] },
  gbc: { pick: "gambatte", alts: ["sameboy"] },
  gba: { pick: "mgba", alts: ["gpsp", "vba_next"] },
  n64: { pick: "mupen64plus_next", alts: [] },
  md: { pick: "genesis_plus_gx", alts: ["picodrive", "genesis_plus_gx_wide"] },
  sms: { pick: "genesis_plus_gx", alts: ["picodrive"] },
  gg: { pick: "genesis_plus_gx", alts: ["picodrive"] },
  sg: { pick: "genesis_plus_gx", alts: ["gearsystem"] },
  segacd: { pick: "genesis_plus_gx", alts: ["picodrive"] },
  "32x": { pick: "picodrive", alts: [] },
  pce: { pick: "mednafen_pce_fast", alts: ["mednafen_supergrafx", "geargrafx"] },
  pcecd: { pick: "mednafen_pce_fast", alts: ["mednafen_supergrafx"] },
  ps1: { pick: "pcsx_rearmed", alts: [] },
  psp: { pick: "ppsspp", alts: [] },
  nds: { pick: "melonds", alts: ["desmume"] },
  ngp: { pick: "mednafen_ngp", alts: ["race"] },
  ws: { pick: "mednafen_wswan", alts: [] },
  saturn: { pick: "yabause", alts: [] },
  arcade: { pick: "fbneo", alts: ["mame2003_plus"] },
  neocd: { pick: "neocd", alts: [] },
  a2600: { pick: "stella", alts: ["stella2014"] },
  a7800: { pick: "prosystem", alts: [] },
  lynx: { pick: "handy", alts: ["mednafen_lynx", "gearlynx"] },
  col: { pick: "gearcoleco", alts: [] },
  videopac: { pick: "o2em", alts: [] },
  msx: { pick: "bluemsx", alts: ["fmsx"] },
  amstrad: { pick: "cap32", alts: ["crocods"] },
  c64: { pick: "vice_x64", alts: ["vice_x64sc"] },
  zxs: { pick: "fuse", alts: [] },
  vb: { pick: "mednafen_vb", alts: [] },
  wsv: { pick: "potator", alts: [] },
  mini: { pick: "pokemini", alts: [] },
  gw: { pick: "gw", alts: [] },
  pico8: { pick: "retro8", alts: [] },
  chip8: { pick: "jaxe", alts: [] },
  tama: { pick: "tamalibretro", alts: [] },
  scummvm: { pick: "scummvm", alts: [] },
  openbor: { pick: "openbor", alts: [], separate: true },
};

/** The advice for a console in a language (en when the language has none), or null. Pure. */
export function adviceFor(system, lang = "en") {
  const a = CORE_ADVICE[system];
  if (!a) return null;
  const words = CORE_ADVICE_WORDS[lang] ?? CORE_ADVICE_WORDS.en;
  const say = (k) => words[k] ?? CORE_ADVICE_WORDS.en[k];
  return { pick: a.pick, why: say(system), alts: a.alts.map((core) => ({ core, why: say(`${system}.${core}`) })), separate: Boolean(a.separate) };
}
