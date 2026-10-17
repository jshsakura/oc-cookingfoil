/**
 * The names a retro game's files get on the SD card. The server keeps the
 * operator's file names ("젤다의 전설 1 - 하이랄 판타지 (Zelda no Densetsu 1 -
 * The Hyrule Fantasy) [J-K v20230715 v1 font.galmuri].zip"), but on the card
 * every file is plain ASCII and short: the English title, no patch or version
 * tags, at most NAME_MAX characters.
 *
 *   roms/<system>/<stem><ext>              the ROM (a .cue or .m3u rewritten to name its new files)
 *   roms/<system>/<stem> (Track n).bin     a .cue's tracks (just <stem>.bin when there is one)
 *   roms/<system>/<stem> (Disc n)<ext>     a multi-disc game's discs
 *   roms/<system>/<id>/…                   a ScummVM game's folder, named by its ScummVM game id
 *                                          (not the title), its files' own names kept
 *
 * Patch variants of one game would share a stem; all but the first by id get
 * " (<last 6 of the id>)" so none overwrites another.
 */
import fsp from "fs/promises";
import path from "path";
import { pathProblem } from "../meta/console-paths.js";

export const NAME_MAX = 80;
const SUFFIX_ROOM = 22; // " (Disc 12) (Track 99)" and the like
const TAG_TAIL_RE = /(\s*\[[^\]]*\])+\s*$/;
const NON_ASCII_RE = /[^\x20-\x7e]/;

/** The name without its trailing [patch / version] tags. Pure. */
export function withoutTags(name) {
  return String(name).replace(TAG_TAIL_RE, "").trim();
}

/** The trailing [tags] of a name, joined, or null. Pure. */
export function tagsOf(name) {
  const m = String(name).match(TAG_TAIL_RE);
  if (!m) return null;
  const tags = [...m[0].matchAll(/\[([^\]]*)\]/g)].map((t) => t[1].trim()).filter(Boolean);
  return tags.length ? tags.join(" ") : null;
}

/** The last top-level "( … )" group of a string, nested parentheses kept. Pure. */
export function lastGroup(s) {
  let depth = 0;
  let end = -1;
  for (let i = s.length - 1; i >= 0; i--) {
    if (s[i] === ")") {
      if (depth === 0) end = i;
      depth++;
    } else if (s[i] === "(" && depth > 0) {
      depth--;
      if (depth === 0) return s.slice(i + 1, end);
    }
  }
  return null;
}

/** Only letters, digits, space and - _ . ( ); anything else goes. Pure. */
export function asciiOnly(s) {
  return String(s)
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^A-Za-z0-9 _.()-]+/g, " ")
    .replace(/\(\s*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[ .]+$/, "");
}

/**
 * A game's SD stem: an ASCII name as it is, or the English title a
 * "한글명 (English)" name carries, without tags. Empty when nothing ASCII is left. Pure.
 */
export function sdStem(name, max = NAME_MAX - SUFFIX_ROOM) {
  const bare = withoutTags(name);
  let base = bare;
  if (NON_ASCII_RE.test(bare)) {
    const english = lastGroup(bare);
    base = english && /[A-Za-z]/.test(english) ? english : bare;
  }
  let stem = asciiOnly(base);
  if (stem.length > max) stem = stem.slice(0, max).replace(/[ .(-]+$/, "").trim();
  return stem;
}

/** A .cue with its FILE lines pointing at new names (`renames`: old → new). Pure. */
export function rewriteCue(text, renames) {
  return text.replace(/^(\s*FILE\s+)(?:"([^"]+)"|(\S+))(.*)$/gim, (line, head, quoted, bare, tail) => {
    const old = quoted ?? bare;
    const next = renames.get(old) ?? renames.get(old.replaceAll("\\", "/"));
    return next ? `${head}"${next}"${tail}` : line;
  });
}

const cueRefs = (text) => [...text.matchAll(/^\s*FILE\s+(?:"([^"]+)"|(\S+))/gim)].map((m) => m[1] ?? m[2]);

/**
 * Plan one game's SD files. `readText(abs)` reads a .cue or .m3u from disk.
 * Returns { stem, rom, romText?, extras: Map(source rel → { sd, text? }) }.
 */
export async function planGame(g, stem, readText = (abs) => fsp.readFile(abs, "utf8"), folder = stem) {
  const dir = `roms/${g.system}`;
  const extras = new Map();
  const byRel = new Map(g.extras.map((x) => [x.rel, x]));
  const romExt = path.extname(g.rel).toLowerCase();

  /** A .cue named `base`: its tracks follow it; returns the rewritten text. */
  async function cue(cueRel, base, abs) {
    const text = await readText(abs).catch(() => "");
    const refs = cueRefs(text);
    const renames = new Map();
    refs.forEach((ref, i) => {
      const ext = path.extname(ref).toLowerCase();
      const name = refs.length === 1 ? `${base}${ext}` : `${base} (Track ${i + 1})${ext}`;
      renames.set(ref, name);
      const rel = path.posix.join(path.posix.dirname(cueRel), ref.replaceAll("\\", "/"));
      if (byRel.has(rel)) extras.set(rel, { sd: `${dir}/${name}` });
    });
    return rewriteCue(text, renames);
  }

  // A ScummVM game is its folder: ScummVM finds the data by its original names
  // and subfolders, and two games' files must not meet in one folder.
  if (romExt === ".scummvm") {
    const gameDir = `${dir}/${folder}`;
    const base = path.posix.dirname(g.rel);
    for (const [i, x] of g.extras.entries()) {
      const inner = path.posix.relative(base, x.rel);
      const ext = path.extname(x.rel).toLowerCase();
      const fallback = `${stem} (extra ${i + 1})${/^\.[a-z0-9]+$/.test(ext) ? ext : ""}`;
      extras.set(x.rel, { sd: `${gameDir}/${pathProblem(inner) ? fallback : inner}` });
    }
    return { stem, rom: `${gameDir}/${stem}${romExt}`, extras };
  }

  let romText;
  if (romExt === ".m3u") {
    // Generated for a disc set, or the operator's own playlist.
    const lines = g.m3u ? g.m3u.split("\n").filter(Boolean) : (await readText(g.abs).catch(() => "")).split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
    const names = [];
    for (const [i, line] of lines.entries()) {
      const rel = path.posix.join(path.posix.dirname(g.rel), line.replaceAll("\\", "/"));
      const disc = byRel.get(rel);
      const ext = path.extname(line).toLowerCase();
      const name = `${stem} (Disc ${i + 1})${ext}`;
      names.push(name);
      if (!disc) continue;
      extras.set(rel, ext === ".cue" ? { sd: `${dir}/${name}`, text: await cue(rel, `${stem} (Disc ${i + 1})`, disc.abs) } : { sd: `${dir}/${name}` });
    }
    romText = names.join("\n") + "\n";
  } else if (romExt === ".cue") {
    romText = await cue(g.rel, stem, g.abs);
  }
  // Anything a playlist or cue didn't name keeps a cleaned copy of its own name.
  for (const x of g.extras) {
    if (extras.has(x.rel)) continue;
    // Nothing usable left of a non-ASCII name ("설명서", "자료.sav" → ".sav"): the game's id keeps it unique.
    const cleaned = asciiOnly(path.posix.basename(x.rel));
    const ext = path.extname(x.rel).toLowerCase();
    const name = cleaned && !cleaned.startsWith(".") && !pathProblem(cleaned) ? cleaned : `${stem} (extra ${g.extras.indexOf(x) + 1})${/^\.[a-z0-9]+$/.test(ext) ? ext : ""}`;
    extras.set(x.rel, { sd: `${dir}/${name}` });
  }
  return { stem, rom: `${dir}/${stem}${romExt}`, ...(romText !== undefined ? { romText } : {}), extras };
}

/** Give every game its SD plan (`g.sd`); patch variants sharing a stem get id suffixes. */
export async function assignSdNames(games, readText) {
  const groups = new Map();
  for (const g of games) {
    // An arcade set must keep its short name (sf2.zip): the core finds it by that name.
    // A short name the card can't create is no use to the core either; fall back like any other game.
    const kept = g.keepFileName ? path.basename(g.rel, path.extname(g.rel)) : null;
    const base = kept && !pathProblem(kept) ? kept : sdStem(g.name) || g.id;
    const key = `${g.system}\0${base.toLowerCase()}`;
    groups.set(key, [...(groups.get(key) ?? []), { g, base }]);
  }
  // A ScummVM game's folder is its game id; two copies of one game (a patched
  // and an original) get the later one's id suffix, like stems do.
  const folders = new Set();
  for (const members of groups.values()) {
    members.sort((a, b) => a.g.id.localeCompare(b.g.id));
    for (const [i, { g, base }] of members.entries()) {
      const stem = i === 0 ? base : `${base} (${g.id.slice(-6)})`;
      let folder = g.scummvmId ?? stem;
      if (folders.has(`${g.system}\0${folder.toLowerCase()}`)) folder = `${folder}-${g.id.slice(-6)}`;
      folders.add(`${g.system}\0${folder.toLowerCase()}`);
      g.sd = await planGame(g, stem, readText, folder);
    }
  }
}
