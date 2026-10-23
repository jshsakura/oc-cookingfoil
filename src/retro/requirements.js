/**
 * What the games in the library still need to start, per system that has
 * games: the core each uses and the firmware its core needs or can use. The
 * admin page's retro tab and GET /admin/api/retro/requirements both show it.
 *
 *   { note, retroarch: "installed" | "missing", complete,
 *     systems: [{ id, names, games, missing, check,
 *                 cores:    [{ core, file, server, console, games, state, warn, reason?, message? }],
 *                 firmware: [{ files, required, state, file?, recognizedAs?, console?, md5? }],
 *                 arcade?:  { sets, missingSets, bios: [{ zip, sets, state }], parents: [{ zip, sets }] } }] }
 *
 *   firmware state  present | missing | mismatch (the file is there under its name but its md5 is
 *                   not a documented dump: another revision may still work). It is the state of
 *                   the very file the console gets at that path (bios.js firmwareDelivery)
 *   core state      the pack's own (CORE_STATES; an automatic installer may say installing,
 *                   will-install, pinned, held, not-in-nightly, failed …), else present | missing
 *                   from the file. `reason` is a machine code (CORE_REASONS), `message` a sentence
 *   missing         required firmware not there and arcade zips not found; optional firmware
 *                   never counts
 *   check           required firmware there but of another dump (mismatch): not missing, still
 *                   to be looked at. Systems with something missing come first, then those to check
 *   complete        no system misses anything or has anything to check
 *
 * Cores are the server's job (the retro pack supplies them); the firmware and
 * arcade BIOS are the operator's. Nothing here writes or fetches a file.
 *
 * Extension point: a game that should run on another core (a modded arcade
 * core for Korean sets, operator supplied) would name it in its own `core`;
 * packStatus groups games by that field, so its core shows here unchanged.
 */
import path from "path";
import { BIOS, firmwareDelivery, firmwareRenames, md5Cache, ruleGroups } from "./bios.js";
import { dependencies, setInfo } from "./arcade.js";
import { packStatus } from "./pack-status.js";

export const CORE_NOTE = "Cores are Switch .nro files built for libnx, named <core>_libretro_libnx.nro: the .dll, .so or .dylib cores of PC RetroArch do not run on the Switch. "
  + "On the server they go in retroarch/cores/ under the retro folder; the console gets them in sdmc:/retroarch/cores/.";

/** Every core state a pack may report; the admin page has words for each and a generic one for any other. */
export const CORE_STATES = ["present", "missing", "installing", "will-install", "pinned", "nightly", "operator-owned",
  "held", "not-in-bundle", "not-in-nightly", "failed", "off"];
/** The machine reasons a pack may give with a state; the page words each and falls back to a generic sentence. */
export const CORE_REASONS = ["download", "install", "rollback", "disk-floor", "crc-mismatch", "bad-zip", "sha256", "hash",
  "not-in-nightly", "in-trash", "auto-off"];
// The states with which the games of that system do not start.
const CORE_WARN = new Set(["missing", "not-in-bundle", "not-in-nightly", "failed"]);
const lower = (s) => String(s).toLowerCase();
const baseOf = (f) => f.slice(f.lastIndexOf("/") + 1);
const dirOf = (f) => f.slice(0, Math.max(0, f.lastIndexOf("/")));

/** One core of a system as the view shows it. Pure. */
export function coreView(c) {
  const file = baseOf(c.file);
  const state = typeof c.state === "string" && c.state ? c.state : c.installed ? "present" : "missing";
  return {
    core: c.core, file, server: `retroarch/${c.file}`, console: `sdmc:/retroarch/${c.file}`, games: c.games, state,
    warn: CORE_WARN.has(state), ...(c.reason ? { reason: String(c.reason) } : {}), ...(c.message ? { message: String(c.message) } : {}),
  };
}

/** The groups that apply to a system's games: extension-bound ones only with such a game; a required one hides its optional twin. */
function applicable(rule, exts) {
  const groups = ruleGroups(rule).filter((g) => !g.ext || g.ext.some((e) => exts.has(e)));
  const required = new Set(groups.filter((g) => g.required).map((g) => g.files.join("\0")));
  return groups.filter((g) => g.required || !required.has(g.files.join("\0")));
}

/**
 * The files the core reads as `want`, as delivered to the console: the one at that path, then for a
 * core that searches subfolders (NeoCD) those under it. A file known by md5 is looked for only when
 * nothing has that path by name, so the hashes are read only then.
 */
async function reaching(rule, want, ctx) {
  const w = lower(want);
  let at = ctx.named;
  if (!at.has(w) && rule.md5?.[want]) at = await ctx.hashed();
  const nested = rule.nested ? [...at.values()].filter((f) => lower(f.path) !== w && lower(baseOf(f.path)) === lower(baseOf(want)) && lower(f.path).startsWith(`${lower(dirOf(want))}/`)) : [];
  return [...(at.has(w) ? [at.get(w)] : []), ...nested.sort((a, b) => (a.rel < b.rel ? -1 : 1))];
}

/** One group's state: the first of its files the console gets with a documented md5 (or none known), else another dump, else missing. */
async function groupState(rule, group, ctx) {
  let mismatch = null;
  for (const want of group.files) {
    const hashes = rule.md5?.[want];
    for (const f of await reaching(rule, want, ctx)) {
      const where = { file: f.rel, ...(f.rank === 3 ? { recognizedAs: want } : {}), console: `retroarch/system/${f.path}` };
      const actual = hashes ? await ctx.cache.md5(path.join(ctx.dir, f.rel)) : null;
      if (!hashes || !actual || hashes.includes(actual)) return { state: "present", ...where };
      mismatch ??= { state: "mismatch", ...where, md5: { expected: hashes, actual } };
    }
  }
  return mismatch ?? { state: "missing" };
}

/** Where FBNeo finds a BIOS or parent zip besides the game's folder: system/fbneo/ or system/ itself. */
const zipInSystem = (zip, files) => files.some((f) => lower(baseOf(f)) === zip && ["", "fbneo"].includes(lower(f.slice(0, Math.max(0, f.lastIndexOf("/"))))));

/** The BIOS and parent zips the arcade sets of one system need, or null when it has no sets. */
function arcadeView(games, files) {
  const sets = games.filter((g) => g.set);
  if (!sets.length) return null;
  const bios = new Map();
  const parents = new Map();
  let missingSets = 0;
  for (const g of sets) {
    let short = false;
    for (const dep of dependencies(g.set)) {
      const zip = `${dep}.zip`;
      const missing = (g.missing ?? []).includes(dep) && !zipInSystem(zip, files);
      short ||= missing;
      if (setInfo(dep)?.bios) {
        const b = bios.get(zip) ?? { zip, sets: 0, state: "present" };
        bios.set(zip, { ...b, sets: b.sets + 1, state: missing ? "missing" : b.state });
      } else if (missing) parents.set(zip, { zip, sets: (parents.get(zip)?.sets ?? 0) + 1 });
    }
    if (short) missingSets++;
  }
  const byZip = (a, b) => (a.zip < b.zip ? -1 : 1);
  return { sets: sets.length, missingSets, bios: [...bios.values()].sort(byZip), parents: [...parents.values()].sort(byZip) };
}

/**
 * The view for `games` (the catalog's) and `systems`, reading the pack at
 * `packDir` and the firmware listing `files` of `firmwareDir` (listed once by
 * the caller). Hashes go through `cache`, so an unchanged file is read once.
 */
export async function requirements({ games, systems, packDir, firmwareDir, files, cache = md5Cache, rules = BIOS, coreStates = [] }) {
  // The upkeep's word on a console's core wins over the file check (auto-cores.js coreStates).
  const upkeep = new Map(coreStates.map((st) => [`${st.id}\0${st.core}`, st]));
  const stateOf = (id, c) => {
    const st = upkeep.get(`${id}\0${c.core}`);
    return st ? { ...c, state: st.state, reason: st.reason, message: st.message } : c;
  };
  const pack = packStatus(packDir, games, systems);
  let hashed = null;
  // What the console gets by name, and with the files known by md5 only when some file is missing by name.
  const ctx = {
    cache, dir: firmwareDir, named: firmwareDelivery(files, new Map(), rules),
    hashed: () => (hashed ??= firmwareRenames(firmwareDir, files, cache, rules).then((renames) => firmwareDelivery(files, renames, rules))),
  };
  const out = [];
  for (const s of pack.systems) {
    const own = games.filter((g) => g.system === s.id);
    const exts = new Set(own.map((g) => lower(path.extname(g.rel ?? ""))));
    const rule = Object.hasOwn(rules, s.id) ? rules[s.id] : null;
    const firmware = [];
    for (const g of rule ? applicable(rule, exts) : []) firmware.push({ files: g.files, required: g.required, ...(await groupState(rule, g, ctx)) });
    const arcade = arcadeView(own, files);
    const missing = firmware.filter((f) => f.required && f.state === "missing").length
      + (arcade ? arcade.bios.filter((b) => b.state === "missing").length + arcade.parents.length : 0);
    const check = firmware.filter((f) => f.required && f.state === "mismatch").length;
    out.push({
      id: s.id, names: systems[s.id]?.names ?? { en: s.id }, games: s.games, missing, check,
      cores: s.cores.map((c) => coreView(stateOf(s.id, c))), firmware, ...(arcade ? { arcade } : {}),
    });
  }
  const order = (s) => (s.missing ? 2 : s.check ? 1 : 0);
  out.sort((a, b) => order(b) - order(a));
  return { note: CORE_NOTE, retroarch: pack.retroarch, complete: out.every((s) => !s.missing && !s.check), systems: out };
}
