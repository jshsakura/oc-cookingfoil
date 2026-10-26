/**
 * Pictures a game's own files do not carry, fetched once from outside and kept on disk.
 *
 * What a slot shows, first match wins (every route, version and detail asks this module only for the
 * last two steps; the first two stay where they were):
 *   1. the admin's upload                  meta/custom-art.js
 *   2. the picture read from the game file   data/icons (meta/nacp-extractor.js); a banner is drawn from it
 *   3. titledb, downloaded once              data/art-fill/ (this module, filled by art-filler.js)
 *   4. a metadata plugin, downloaded once    data/art-fill/ as well
 * A banner or screenshots are never taken from steps 3 or 4 for a game that has a step 1 or 2 picture
 * of the kind that draws them (a banner follows the icon), so a game with art in its files looks as before.
 *
 * Layout, apart from data/icons so a picture read from a game file later wins and nothing needs deleting:
 *   data/art-fill/<id>.icon.webp            the icon (meta/art-ingest.js ART.icon)
 *   data/art-fill/<id>.banner.webp          a wide banner, only where the source has one
 *   data/art-fill/<id>.screen.<n>.webp      screenshots, up to MAX_SHOTS
 *   data/art-fill/<id>.drawn.jpg            a banner drawn from the filled icon (meta/icon-banner.js)
 *   data/art-fill/state.json                where each picture came from and when a miss may be tried again
 *
 * The files are the truth; state.json only says which source gave them and when to try again. Turning the
 * setting off (fillMissingArt) stops new downloads and hides what is already here: every question below
 * answers "none" then, so the library shows file-only art. Turning it on brings them back.
 *
 * Reads are from memory (the folder is listed once). Nothing here fetches; art-filler.js does, in the background.
 */
import fs from "node:fs";
import path from "node:path";
import * as env from "../helpers/envs.js";
import { cachePathFor, dropVariants, forget, hasCached } from "./image-cache.js";

export const MAX_SHOTS = 8;
export const STATE_FILE = "state.json";

const dir = () => env.artFillDir;
const NAME_RE = /^[0-9A-F]{16}\.(?:icon\.webp|banner\.webp|screen\.\d+\.webp|drawn\.jpg)$/;

let listing = null;
let listedDir = null;
const names = () => {
  if (!listing || listedDir !== dir()) {
    listedDir = dir();
    try {
      listing = new Set(fs.readdirSync(listedDir).filter((n) => NAME_RE.test(n)));
    } catch {
      listing = new Set();
    }
  }
  return listing;
};

/** Whether new pictures are fetched, and the ones already kept shown (the admin setting). */
export const enabled = () => env.fillMissingArt === true;

const nameOf = (base, kind, idx = 0) =>
  kind === "icon" ? `${base}.icon.webp` : kind === "banner" ? `${base}.banner.webp` : kind === "drawn" ? `${base}.drawn.jpg` : `${base}.screen.${idx}.webp`;

/** Where a filled picture is (or would be) kept: kind icon | banner | screenshot | drawn. */
export const fillPath = (base, kind, idx = 0) => path.join(dir(), nameOf(base, kind, idx));

/** Whether a filled picture is on disk, shown or not. */
export const kept = (base, kind, idx = 0) => names().has(nameOf(base, kind, idx));

/** The filled picture's file, or null when none is kept or the setting is off. */
export const filled = (base, kind, idx = 0) => (enabled() && kept(base, kind, idx) ? fillPath(base, kind, idx) : null);

/** A store notes a file it wrote (or removed), so the next question sees it. */
export function noteWritten(file) {
  const n = path.basename(file);
  if (!NAME_RE.test(n)) return;
  if (fs.existsSync(file)) names().add(n);
  else names().delete(n);
  forget(file);
  dropVariants(file);
}

let wanter = null;
/** art-filler.js says who is told when a screen shows a game that lacks a picture. */
export const setWanter = (fn) => { wanter = fn; };
/** A screen asks for a game's missing pictures to be fetched in the background; it never waits for them. */
export const want = (base) => { wanter?.(base); };

/** Test and start: list the folder again. */
export const relist = () => { listing = null; };

const fileIcon = (base) => hasCached(cachePathFor(base, "icon"));

/** The icon of a game whose files carry none: the filled one, or null. */
export const iconFallback = (base) => (fileIcon(base) ? null : filled(base, "icon"));

/** The source's own wide banner, for a game with no icon of its own to draw one from (the caller has ruled out the admin's). */
export const bannerFallback = (base) => (fileIcon(base) ? null : filled(base, "banner"));

/** Screenshot slots the filled pictures give, 0..n-1 (the caller has ruled out the admin's). */
export function shotSlots(base) {
  if (!enabled()) return [];
  const out = [];
  for (let i = 0; i < MAX_SHOTS; i++) if (kept(base, "screenshot", i)) out.push(i);
  return out;
}

// ---- where each picture came from ----
let state = null;
let stateDir = null;
let saveTimer = null;
const stateFile = () => path.join(dir(), STATE_FILE);

function loadState() {
  if (state && stateDir === dir()) return state;
  stateDir = dir();
  try {
    const raw = JSON.parse(fs.readFileSync(stateFile(), "utf8"));
    state = raw && typeof raw === "object" && raw.titles && typeof raw.titles === "object" ? raw : { titles: {} };
  } catch {
    state = { titles: {} };
  }
  return state;
}

/**
 * One title's record: { at, retry, fails, got: { icon?, banner?, screens?: [source] } }, a source being
 * "titledb" or "plugin:<id>". retry is when a miss may be tried again (0: nothing to retry).
 */
export const recordOf = (base) => loadState().titles[base] ?? null;

export function setRecord(base, record) {
  loadState().titles[base] = record;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 1500);
  saveTimer.unref?.();
}

/** Writes the record file now (a timer does it otherwise). */
export function flush() {
  clearTimeout(saveTimer);
  if (!state) return;
  try {
    fs.mkdirSync(dir(), { recursive: true });
    const tmp = `${stateFile()}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, stateFile());
  } catch {
    /* the pictures are the truth; a record not saved only means one more try */
  }
}

/** Drops the loaded record and the folder listing (a test, or after the folder was emptied). */
export function reset() {
  clearTimeout(saveTimer);
  state = null;
  listing = null;
}

/** Where one slot's picture came from: "titledb", "plugin:<id>" or null. */
export function sourceOf(base, kind, idx = 0) {
  const got = recordOf(base)?.got;
  if (!got || !kept(base, kind, idx)) return null;
  return (kind === "screenshot" ? got.screens?.[idx] : got[kind]) ?? null;
}

/** Counts for the admin: titles with a picture from titledb / from a plugin, and the pictures kept. */
export function counts() {
  let titledb = 0;
  let plugin = 0;
  for (const rec of Object.values(loadState().titles)) {
    const all = [rec.got?.icon, rec.got?.banner, ...(rec.got?.screens ?? [])].filter(Boolean);
    if (all.includes("titledb")) titledb++;
    if (all.some((s) => String(s).startsWith("plugin:"))) plugin++;
  }
  return { titledb, plugin, files: names().size };
}
