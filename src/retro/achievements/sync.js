/**
 * The background side of RetroAchievements: each tick reads at most a few
 * consoles' game lists that are a week old, then hashes and matches the ROMs
 * that are new, changed, or older than their console's list. Nothing runs
 * until the admin saves a key.
 */
import debug from "../../debug.js";
import * as env from "../../helpers/envs.js";
import * as activity from "../../tasks/activity.js";
import { titlesOf } from "../meta/build.js";
import * as client from "./client.js";
import * as romHashes from "../rom-hash.js";
import { CONSOLES } from "./hash.js";
import { consoleIndex, matchRom } from "./match.js";
import * as store from "./store.js";
import { ACTIVITY_LANG, retroText } from "../retro-messages.js";

const LOOP_MS = 2 * 60 * 1000;
const FIRST_RUN_MS = 3 * 60 * 1000;
export const LIST_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const LIST_RETRY_MS = 6 * 60 * 60 * 1000;
const LISTS_PER_TICK = 3;
// Hashing reads the ROMs from disk: a tick stops after this long and the next goes on.
const ROM_BUDGET_MS = 20_000;
const PAUSE_MS = 1000;

const stampOf = (g) => `${g.fileSize ?? g.size ?? 0}:${Math.round(g.mtimeMs ?? 0)}`;

/** The console ids whose lists are due, oldest first. Pure. */
export function listsDue(consoleIds, now) {
  return consoleIds
    .filter((id) => {
      const l = store.list(id);
      if (l && now - l.at < LIST_AGE_MS) return false;
      return !l?.triedAt || now - l.triedAt >= LIST_RETRY_MS;
    })
    .sort((a, b) => (store.list(a)?.at ?? 0) - (store.list(b)?.at ?? 0));
}

/**
 * The catalog games whose match is missing or stale: no match yet, the file's
 * size or time moved, the list is newer, or the shared hash (rom-hash.js, which
 * also sees an overwrite that put the mtime back) is no longer the matched one.
 */
export function romsDue(games) {
  return games.filter((g) => {
    const l = store.list(CONSOLES[g.system]);
    if (!l?.at) return false;
    const r = store.rom(g.id);
    const shared = romHashes.known(g);
    return !r || r.stamp !== stampOf(g) || r.listAt < l.at || (shared !== null && shared !== r.hash);
  });
}

async function readLists(due, { fetchImpl, now, pauseMs }) {
  let read = 0;
  for (const id of due.slice(0, LISTS_PER_TICK)) {
    const prev = store.list(id);
    try {
      const games = await client.gameList(id, { fetchImpl });
      store.setList(id, { at: now(), triedAt: now(), games });
      read++;
    } catch (err) {
      debug.error("retro achievements: list of console %d: %s", id, err.message);
      store.setList(id, { at: prev?.at ?? 0, triedAt: now(), games: prev?.games ?? [] });
    }
    if (pauseMs) await new Promise((r) => setTimeout(r, pauseMs));
  }
  return read;
}

async function matchRoms(due, { now }) {
  const indexes = new Map();
  const started = now();
  let matched = 0;
  for (const g of due) {
    if (now() - started > ROM_BUDGET_MS) break;
    const consoleId = CONSOLES[g.system];
    const l = store.list(consoleId);
    if (!indexes.has(consoleId)) indexes.set(consoleId, consoleIndex(l.games));
    // Read once for the whole server: the shared hash, worked out now when the background pass hasn't yet.
    const hash = await romHashes.hashOf(g);
    const ra = matchRom(indexes.get(consoleId), hash, titlesOf(g));
    store.setRom(g.id, { stamp: stampOf(g), hash, ra, listAt: l.at });
    if (ra) matched++;
  }
  return matched;
}

let running = null;

/** One tick. `current()` gives the catalog ({ games }). */
export function tick({ current, fetchImpl = fetch, now = Date.now, pauseMs = PAUSE_MS } = {}) {
  if (running) return running;
  if (!client.configured()) return Promise.resolve(null);
  let job = null;
  running = (async () => {
    const { games } = await current();
    const ours = games.filter((g) => CONSOLES[g.system]);
    const dropped = store.keepRoms(new Set(ours.map((g) => g.id)));
    const lists = listsDue([...new Set(ours.map((g) => CONSOLES[g.system]))], now());
    if (lists.length) job ??= activity.begin("retro-achievements", { title: retroText(ACTIVITY_LANG, "ach.jobLists") });
    const read = await readLists(lists, { fetchImpl, now, pauseMs });
    const roms = romsDue(ours);
    if (roms.length) {
      job ??= activity.begin("retro-achievements", { title: retroText(ACTIVITY_LANG, "ach.jobGames") });
      job.step(null, retroText(ACTIVITY_LANG, "ach.count", { n: roms.length }));
    }
    const matched = await matchRoms(roms, { now });
    if (read || roms.length || dropped || lists.length) store.save();
    return { lists: read, roms: roms.length, matched };
  })()
    .then((r) => {
      if (job && (r.lists || r.roms)) job.done(retroText(ACTIVITY_LANG, "ach.done", { lists: r.lists, matched: r.matched }));
      else job?.discard();
      return r;
    }, (err) => { job?.fail(err); throw err; })
    .finally(() => { running = null; });
  return running;
}

let started = false;
export function start({ current, enabled = () => true }) {
  if (started) return;
  started = true;
  debug.log("retro achievements: %d ROMs on file", store.load(env.dataDir));
  const run = () => (enabled() ? tick({ current }) : Promise.resolve(null))
    .then((r) => { if (r?.lists || r?.matched) debug.log("retro achievements: %d lists read, %d of %d ROMs matched", r.lists, r.matched, r.roms); })
    .catch((err) => debug.error("retro achievements: %s", err.message));
  setTimeout(run, FIRST_RUN_MS).unref();
  setInterval(run, LOOP_MS).unref();
}

/** For tests. */
export function reset() {
  running = null;
}
