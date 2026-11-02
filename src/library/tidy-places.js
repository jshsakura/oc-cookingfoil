/**
 * 정리 for the folders other than games: each folder's own layout (helpers/folder-guides.js), applied to what a
 * person picked, after a preview. Nothing is renamed; a file or folder only moves to where its folder expects it.
 *
 *   retro     a ROM outside roms/<console>/, in a console's folder that does not play it, or deeper than
 *             roms/<console>/<folder>/ goes to roms/<console>/ of the one console that plays its extension.
 *             An extension several consoles play, and a disc set's files (.cue, .bin and the like), stay.
 *   homebrew  a loose .nro at the top goes into a folder of its own named after it.
 *   patches,  a folder at the top that names its game ("Name [TITLEID]", or for a patch an
 *   saves     atmosphere/contents/<TITLEID>/ inside) goes under <TITLEID>/. Loose files stay.
 *
 *   createPlaceTidy({ root, collect, planner, keep, journal, rescan })
 *     plan(rels, lang)          { moves: [{ from, to }], held: [{ rel, code, reason }] }
 *     apply(rels, accepted, by) { moved: [{ from, to, undo }], skipped: [{ from, code }] }
 *
 * The planners are pure over [{ rel, dir }]: every entry under the picks, relative to the folder's top.
 */
import fsp from "fs/promises";
import path from "path";
import { baseTitleIdOf } from "../meta/image-cache.js";
import { metaText } from "../meta/meta-messages.js";
import { systemOfExtension, systemOfFolder } from "../retro/systems.js";
import { SERVER_FILES } from "./file-roots.js";
import { carryOut } from "./tidy.js";

const TITLE_ID = /^[0-9A-F]{16}$/i;
const NAMED_ID = /\s*\[([0-9A-F]{16})\]\s*/i;
const LEADING_ID = /^([0-9A-F]{16})(?:$|[\s._-]+)/i;
const CONTENTS_ID = /(?:^|\/)contents\/([0-9A-F]{16})(?:\/|$)/i;
// Files that name each other: moving one alone breaks the set.
const DISC_SET = new Set([".cue", ".bin", ".img", ".ccd", ".sub", ".m3u", ".gdi", ".toc", ".mds", ".mdf"]);
// The SD card's own folders: a patch laid out from the card's root has no name of its own yet.
const SD_ROOTS = new Set(["atmosphere", "contents", "switch"]);
const ROM_FILE_DEPTH = 4; // roms/<console>/<folder>/<file>

const parts = (rel) => rel.split("/");
const held = (rel, code, vars) => ({ rel, code, ...(vars ? { vars } : {}) });

export function planRetro(entries, systems) {
  const moves = [];
  const holds = [];
  const plays = new Set(Object.values(systems).flatMap((s) => s.extensions));
  for (const f of entries) {
    if (f.dir) continue;
    const p = parts(f.rel);
    if (SERVER_FILES.retro.has(p[0])) continue;
    const ext = path.extname(f.rel).toLowerCase();
    if (!plays.has(ext)) continue;
    const id = p[0] === "roms" && p.length >= 3 ? systemOfFolder(p[1], systems) : null;
    const fits = Boolean(id && systems[id].extensions.includes(ext));
    if (fits && p.length <= ROM_FILE_DEPTH) continue;
    if (DISC_SET.has(ext)) { holds.push(held(f.rel, "tidy.retroDisc")); continue; }
    const to = fits ? id : systemOfExtension(ext, systems);
    if (!to) { holds.push(held(f.rel, "tidy.retroExt", { ext })); continue; }
    moves.push({ from: f.rel, to: `roms/${systems[to].folder}/${p.at(-1)}` });
  }
  return { moves, held: holds };
}

const appFolder = (stem) => stem.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "") || "app";

export function planHomebrew(entries) {
  const moves = [];
  const holds = [];
  for (const f of entries) {
    if (f.dir || f.rel.includes("/")) continue;
    if (path.extname(f.rel).toLowerCase() !== ".nro") { holds.push(held(f.rel, "tidy.looseFile")); continue; }
    moves.push({ from: f.rel, to: `${appFolder(path.basename(f.rel, path.extname(f.rel)))}/${f.rel}` });
  }
  return { moves, held: holds };
}

/** The game a folder at the top of patches or saves names, from its name or (patches) the contents/ inside it. */
function titleOf(name, inside, key) {
  const named = NAMED_ID.exec(name)?.[1] ?? LEADING_ID.exec(name)?.[1];
  if (named) return baseTitleIdOf(named.toUpperCase());
  if (key !== "patches") return null;
  const found = new Set(inside.map((rel) => CONTENTS_ID.exec(rel)?.[1]?.toUpperCase()).filter(Boolean).map(baseTitleIdOf));
  return found.size === 1 ? [...found][0] : null;
}

export function planTitled(entries, key) {
  const moves = [];
  const holds = [];
  for (const f of entries) {
    const p = parts(f.rel);
    if (!f.dir) {
      if (p.length === 1 || (p.length === 2 && TITLE_ID.test(p[0]))) holds.push(held(f.rel, "tidy.looseFile"));
      continue;
    }
    if (p.length !== 1 || TITLE_ID.test(f.rel) || f.rel === "homebrew") continue;
    if (SD_ROOTS.has(f.rel.toLowerCase())) { holds.push(held(f.rel, "tidy.sdLayout")); continue; }
    const inside = entries.filter((e) => e.rel.startsWith(`${f.rel}/`)).map((e) => e.rel.slice(f.rel.length + 1));
    const tid = titleOf(f.rel, inside, key);
    if (!tid) { holds.push(held(f.rel, "tidy.noTitle")); continue; }
    const name = f.rel.replace(NAMED_ID, " ").replace(LEADING_ID, "").trim() || f.rel;
    moves.push({ from: f.rel, to: `${tid}/${name}` });
  }
  return { moves, held: holds };
}

const same = (s) => s.normalize("NFC").toLowerCase();

export function createPlaceTidy({ root, collect, planner, keep = () => false, journal, rescan = () => {} }) {
  async function plan(rels, lang = "en") {
    const out = planner(await collect(rels));
    const moves = [];
    const holds = [...out.held];
    const taken = new Set();
    for (const m of out.moves) {
      if (same(m.from) === same(m.to)) continue;
      const there = await fsp.lstat(path.join(root().dir, ...m.to.split("/"))).then(() => true, () => false);
      if (there || taken.has(same(m.to))) { holds.push(held(m.from, there ? "tidy.exists" : "tidy.sameName", { to: m.to })); continue; }
      taken.add(same(m.to));
      moves.push(m);
    }
    return { root: root().key, moves, held: holds.map(({ rel, code, vars }) => ({ rel, code, reason: metaText(lang, code, vars) })) };
  }

  async function apply(rels, accepted, { by = null } = {}) {
    const ok = new Set((accepted ?? []).map((m) => `${m.from}\0${m.to}`));
    const out = await carryOut({ root: root(), moves: (await plan(rels)).moves.filter((m) => ok.has(`${m.from}\0${m.to}`)), journal, by, keep });
    if (out.moved.length) rescan();
    return out;
  }

  return { plan, apply };
}
