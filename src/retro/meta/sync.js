/**
 * Fills retro-meta.json and the screenshots in the background, slowly, so a
 * game's detail only reads what is already there:
 *
 *   weekly     LaunchBox's Metadata.zip (the copy the ratings keep in
 *              <data dir>/launchbox/, fetched only when newer) matched to every game
 *   each tick  a few games LaunchBox has nothing on are asked of IGDB (with its keys),
 *              then a few games' screenshots are downloaded
 *
 * All of it waits for the "레트로 게임 정보" setting (COOK_RETRO_META);
 * screenshots also for "공식 이미지" (COOK_ESHOP_ARTWORK). The loop always runs
 * and checks them each tick, so they can be switched from the admin page
 * without a restart.
 */
import path from "path";
import debug from "../../debug.js";
import * as env from "../../helpers/envs.js";
import { fetchMetadata, readXml, shrankTooMuch } from "../art/ratings.js";
import { PLATFORMS } from "../art/titles.js";
import { buildMeta, metaKey, titlesOf, wantedKeys } from "./build.js";
import { readLaunchBoxMeta, readMame } from "./launchbox.js";
import * as igdbMeta from "./igdb.js";
import { downloadShots, indexShots, removeShots, shotDir, wantedShots } from "./screenshots.js";
import * as store from "./store.js";

const REFRESH_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const LOOP_MS = 2 * 60 * 1000;
// After the ratings' first check (10 min), so the two never fetch Metadata.zip at once.
const FIRST_RUN_MS = 20 * 60 * 1000;
// A failed LaunchBox match is tried again after this, not every tick.
const REFRESH_RETRY_MS = 6 * 60 * 60 * 1000;
const IGDB_PER_TICK = 10;
const SHOTS_PER_TICK = 10;
const SHOT_RETRY_MS = 24 * 60 * 60 * 1000;
const PAUSE_MS = 300;

const shotTried = new Map(); // key → when its screenshots were last attempted
let running = null;
let refreshTriedAt = 0;
let shotIndex = null; // { dir, at, counts: Map(game folder → screenshots on disk) }

/** One game per key (variants that share a file name share the record). */
const uniqueByKey = (games) => [...new Map(games.map((g) => [metaKey(g), g])).values()];

/**
 * The records after a LaunchBox rebuild: LaunchBox's (and MAME's) for what it
 * matched, IGDB's earlier answers for the rest. Pure.
 */
export function mergeRecords(previous, fresh) {
  const kept = Object.fromEntries(Object.entries(previous).filter(([k, r]) => !fresh[k] && r?.source === "igdb"));
  return { ...kept, ...fresh };
}

/** Keys whose list of screenshots changed, so the files on disk are another game's or stale. Pure. */
export function changedShots(previous, next) {
  return Object.keys(previous).filter((k) => previous[k]?.shots?.length && JSON.stringify(previous[k].shots) !== JSON.stringify(next[k]?.shots ?? null));
}

/** How many of the earlier LaunchBox records are for games still in the catalog. Pure. */
export function launchBoxCount(previous, keys) {
  return Object.entries(previous).filter(([k, r]) => keys.has(k) && r && r.source !== "igdb").length;
}

/** Matches LaunchBox's data to the catalog's games and saves the records. Returns how many games have one. */
export async function refreshLaunchBox({ dir, cacheDir, games, systems, fetchImpl = fetch, now = Date.now }) {
  const zip = await fetchMetadata(cacheDir, fetchImpl);
  const sets = new Set(games.filter((g) => g.set).flatMap((g) => [g.set, g.cloneOf].filter(Boolean)));
  // A failed unzip throws here, before anything is replaced or removed.
  const mame = sets.size ? await readXml(zip, "Mame.xml", (open) => readMame(open(), sets)) : new Map();
  const wanted = new Set([...new Set(games.map((g) => g.system))].flatMap((s) => PLATFORMS[s] ?? []));
  const data = await readXml(zip, "Metadata.xml", (open) => readLaunchBoxMeta(open, wanted, wantedKeys(games, mame)));
  const fresh = buildMeta(games, data, mame);
  if (games.length && !Object.keys(fresh).length) throw new Error("LaunchBox 자료에서 맞는 게임을 찾지 못했습니다");
  const previous = store.all();
  const byKey = new Map(games.map((g) => [metaKey(g), g]));
  // A read far shorter than the last one is a cut-off file, not LaunchBox forgetting games:
  // keep the records and the screenshots as they are.
  const before = launchBoxCount(previous, byKey);
  const after = Object.keys(fresh).length;
  if (shrankTooMuch(before, after)) {
    debug.error("retro meta: LaunchBox matched %d games against %d last time; not applied", after, before);
    throw new Error(`LaunchBox 자료가 지난번 ${before}개에서 ${after}개로 크게 줄어 적용하지 않았습니다`);
  }
  const next = mergeRecords(previous, fresh);
  shotIndex = null; // screenshots may go below, so the index is read again
  for (const key of changedShots(previous, next)) {
    const g = byKey.get(key);
    if (g) await removeShots(dir, systems[g.system], key).catch(() => {});
  }
  store.replace(next, now());
  return Object.keys(fresh).length;
}

/** Games LaunchBox has nothing on and IGDB hasn't been asked about lately. Pure. */
export function igdbDue(games, records, now, limit = IGDB_PER_TICK) {
  return uniqueByKey(games).filter((g) => {
    const r = records[metaKey(g)];
    return !r || (r.source === "igdb" && r.miss && now - (r.at ?? 0) >= igdbMeta.MISS_TTL_MS);
  }).slice(0, limit);
}

const pause = (ms) => (ms ? new Promise((r) => setTimeout(r, ms)) : null);

/** Asks IGDB about a few games and saves its answers. Returns how many it asked. */
export async function igdbBatch({ games, fetchImpl = fetch, now = Date.now, pauseMs = PAUSE_MS }) {
  if (!igdbMeta.configured()) return 0;
  const due = igdbDue(games, store.all(), now());
  const answers = {};
  for (const g of due) {
    try {
      answers[metaKey(g)] = { ...(await igdbMeta.igdbMeta(g.system, titlesOf(g), { fetchImpl })), at: now() };
    } catch (err) {
      debug.error("retro meta: IGDB %s: %s", metaKey(g), err.message);
    }
    await pause(pauseMs);
  }
  if (Object.keys(answers).length) store.replace({ ...store.all(), ...answers });
  return Object.keys(answers).length;
}

/**
 * How many screenshots each game folder holds (screenshots.js indexShots), read
 * from the disk once a day, not once per game per tick; downloads and removals
 * here keep it current in between.
 */
async function shotCounts(dir, now) {
  if (!shotIndex || shotIndex.dir !== dir || now - shotIndex.at >= SHOT_RETRY_MS) {
    shotIndex = { dir, at: now, counts: await indexShots(dir) };
  }
  return shotIndex.counts;
}

/** Downloads the screenshots of a few games that lack theirs. Returns how many files it saved. */
export async function shotsBatch({ dir, games, systems, fetchImpl = fetch, now = Date.now }) {
  const records = store.all();
  const counts = await shotCounts(dir, now());
  const lacking = (g, key) => {
    const folder = shotDir(dir, systems[g.system], key);
    const want = wantedShots(records[key]);
    return folder !== null && want > 0 && (counts.get(folder) ?? 0) < want;
  };
  const due = uniqueByKey(games).filter((g) => {
    const key = metaKey(g);
    return now() - (shotTried.get(key) ?? 0) >= SHOT_RETRY_MS && lacking(g, key);
  }).slice(0, SHOTS_PER_TICK);
  let saved = 0;
  for (const g of due) {
    const key = metaKey(g);
    shotTried.set(key, now());
    try {
      const r = await downloadShots(dir, systems[g.system], key, records[key], { fetchImpl });
      counts.set(shotDir(dir, systems[g.system], key), r.have);
      saved += r.saved;
    } catch (err) {
      debug.error("retro meta: screenshots of %s: %s", key, err.message);
    }
  }
  return saved;
}

/**
 * One tick: the weekly LaunchBox match when it is due, else an IGDB batch and
 * a screenshot batch. `settings()` gives { on, art }; nothing runs while `on` is off.
 */
export async function tick({
  dir = env.retroDir, cacheDir = path.join(env.dataDir, "launchbox"), current, fetchImpl = fetch, now = Date.now,
  settings = () => ({ on: env.retroMeta, art: env.eshopArtwork }), pauseMs = PAUSE_MS,
} = {}) {
  if (running) return running;
  const { on, art } = settings();
  if (!on) return null;
  running = (async () => {
    const { games, systems } = await current();
    if (!games.length) return { idle: true };
    if (now() - store.builtAt() >= REFRESH_AGE_MS && now() - refreshTriedAt >= REFRESH_RETRY_MS) {
      refreshTriedAt = now();
      return { launchbox: await refreshLaunchBox({ dir, cacheDir, games, systems, fetchImpl, now }) };
    }
    // IGDB only fills in after LaunchBox has had its say.
    const igdb = store.builtAt() ? await igdbBatch({ games, fetchImpl, now, pauseMs }) : 0;
    const shots = art ? await shotsBatch({ dir, games, systems, fetchImpl, now }) : 0;
    return { igdb, shots };
  })().finally(() => { running = null; });
  return running;
}

/** Loads the saved records and starts the loop. `current()` gives the catalog ({ games, systems }). */
let started = false;
export function start({ current, enabled = () => true }) {
  if (started) return;
  started = true;
  debug.log("retro meta: %d games on file", store.load(env.dataDir));
  const run = () => (enabled() ? tick({ current }) : Promise.resolve(null))
    .then((r) => {
      if (r?.launchbox !== undefined) debug.log("retro meta: LaunchBox matched %d games", r.launchbox);
      else if (r?.shots || r?.igdb) debug.log("retro meta: %d asked of IGDB, %d screenshots saved", r.igdb ?? 0, r.shots ?? 0);
    })
    .catch((err) => debug.error("retro meta: %s", err.message));
  setTimeout(run, FIRST_RUN_MS).unref();
  setInterval(run, LOOP_MS).unref();
}

/** For tests. */
export function reset() {
  shotTried.clear();
  shotIndex = null;
  running = null;
  refreshTriedAt = 0;
}
