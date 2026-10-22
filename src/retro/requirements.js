/**
 * What the games in the library still need to start, per system that has
 * games: the core each uses and the firmware its core needs or can use. The
 * admin page's retro tab and GET /admin/api/retro/requirements both show it.
 *
 *   { note, retroarch: "installed" | "missing", complete,
 *     systems: [{ id, names, games, missing,
 *                 cores:    [{ core, file, server, console, games, state, warn, reason? }],
 *                 firmware: [{ files, required, state, file?, recognizedAs?, console?, md5? }],
 *                 arcade?:  { sets, missingSets, bios: [{ zip, sets, state }], parents: [{ zip, sets }] } }] }
 *
 *   firmware state  present | missing | mismatch (the file is there under its name but its md5 is
 *                   not a documented dump: another revision may still work)
 *   core state      the pack's own (an automatic installer may say installing, will-install,
 *                   not-in-bundle, operator-owned, failed …), else present | missing from the file
 *   missing         required firmware not present (or mismatched) and arcade zips not found;
 *                   optional firmware never counts. Systems with something missing come first.
 *   complete        no system misses anything
 *
 * Cores are the server's job (the retro pack supplies them); the firmware and
 * arcade BIOS are the operator's. Nothing here writes or fetches a file.
 *
 * Extension point: a game that should run on another core (a modded arcade
 * core for Korean sets, operator supplied) would name it in its own `core`;
 * packStatus groups games by that field, so its core shows here unchanged.
 */
import path from "path";
import { BIOS, consoleFirmwarePath, firmwareRenames, md5Cache, nameMatches, ruleGroups } from "./bios.js";
import { dependencies, setInfo } from "./arcade.js";
import { packStatus } from "./pack-status.js";

export const CORE_NOTE = "Cores are Switch .nro files built for libnx, named <core>_libretro_libnx.nro: the .dll, .so or .dylib cores of PC RetroArch do not run on the Switch. "
  + "On the server they go in retroarch/cores/ under the retro folder; the console gets them in sdmc:/retroarch/cores/.";

const CORE_WARN = new Set(["missing", "not-in-bundle", "failed"]);
const lower = (s) => String(s).toLowerCase();
const baseOf = (f) => f.slice(f.lastIndexOf("/") + 1);

/** One core of a system as the view shows it. Pure. */
export function coreView(c) {
  const file = baseOf(c.file);
  const state = typeof c.state === "string" && c.state ? c.state : c.installed ? "present" : "missing";
  return {
    core: c.core, file, server: `retroarch/${c.file}`, console: `sdmc:/retroarch/${c.file}`, games: c.games, state,
    warn: CORE_WARN.has(state), ...(c.reason ? { reason: String(c.reason) } : {}),
  };
}

/** The groups that apply to a system's games: extension-bound ones only with such a game; a required one hides its optional twin. */
function applicable(rule, exts) {
  const groups = ruleGroups(rule).filter((g) => !g.ext || g.ext.some((e) => exts.has(e)));
  const required = new Set(groups.filter((g) => g.required).map((g) => g.files.join("\0")));
  return groups.filter((g) => g.required || !required.has(g.files.join("\0")));
}

/** One group's state, looked up by name first, then by a documented md5 under another name. */
async function groupState(id, rule, group, ctx) {
  let mismatch = null;
  for (const want of group.files) {
    const hashes = rule.md5?.[want];
    for (const file of ctx.files.filter((f) => nameMatches(f, want, id, rule))) {
      const actual = hashes ? await ctx.cache.md5(path.join(ctx.dir, file)) : null;
      if (!hashes || !actual || hashes.includes(actual)) return { state: "present", file, console: `retroarch/system/${consoleFirmwarePath(file, ctx.rules)}` };
      mismatch ??= { state: "mismatch", file, md5: { expected: hashes, actual } };
    }
  }
  if (mismatch) return mismatch;
  const known = group.files.filter((want) => rule.md5?.[want]);
  const renames = known.length ? await ctx.renames() : new Map();
  for (const want of known) {
    const file = [...renames].find(([, as]) => as === want)?.[0];
    if (file) return { state: "present", file, recognizedAs: want, console: `retroarch/system/${want}` };
  }
  return { state: "missing" };
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
export async function requirements({ games, systems, packDir, firmwareDir, files, cache = md5Cache, rules = BIOS }) {
  const pack = packStatus(packDir, games, systems);
  let renames = null;
  // Files known by their md5 under another name, looked for only when some file is missing by name.
  const ctx = { files, cache, rules, dir: firmwareDir, renames: () => (renames ??= firmwareRenames(firmwareDir, files, cache, rules)) };
  const out = [];
  for (const s of pack.systems) {
    const own = games.filter((g) => g.system === s.id);
    const exts = new Set(own.map((g) => lower(path.extname(g.rel ?? ""))));
    const rule = Object.hasOwn(rules, s.id) ? rules[s.id] : null;
    const firmware = [];
    for (const g of rule ? applicable(rule, exts) : []) firmware.push({ files: g.files, required: g.required, ...(await groupState(s.id, rule, g, ctx)) });
    const arcade = arcadeView(own, files);
    const missing = firmware.filter((f) => f.required && f.state !== "present").length
      + (arcade ? arcade.bios.filter((b) => b.state === "missing").length + arcade.parents.length : 0);
    out.push({
      id: s.id, names: systems[s.id]?.names ?? { en: s.id }, games: s.games, missing,
      cores: s.cores.map(coreView), firmware, ...(arcade ? { arcade } : {}),
    });
  }
  out.sort((a, b) => Number(b.missing > 0) - Number(a.missing > 0));
  return { note: CORE_NOTE, retroarch: pack.retroarch, complete: out.every((s) => !s.missing), systems: out };
}
