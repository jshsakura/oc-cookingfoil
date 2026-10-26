/**
 * Fills retro-meta.json and the screenshots in the background, slowly, so a
 * game's detail only reads what is already there:
 *
 *   weekly     LaunchBox's Metadata.zip (the copy the ratings keep in
 *              <data dir>/launchbox/, fetched only when newer) matched to every game
 *   each tick  a few games LaunchBox has nothing on are asked of IGDB (with its keys),
 *              a few games with an English Wikipedia article get Korean Wikipedia's
 *              lead paragraph as their Korean description (meta/kowiki.js),
 *              then a few games' screenshots are downloaded
 *
 * All of it waits for the "레트로 게임 정보" setting (COOK_RETRO_META). The
 * loop always runs and checks it each tick, so they can be switched from the admin page
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
import * as kowiki from "../../meta/kowiki.js";
import { downloadShots, indexShots, removeShots, shotDir, wantedShots } from "./screenshots.js";
import * as store from "./store.js";
import * as activity from "../../tasks/activity.js";
import { ACTIVITY_LANG, RetroError, retroText } from "../retro-messages.js";

const REFRESH_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const LOOP_MS = 2 * 60 * 1000;
// After the ratings' first check (10 min), so the two never fetch Metadata.zip at once.
const FIRST_RUN_MS = 20 * 60 * 1000;
// A failed LaunchBox match is tried again after this, not every tick.
const REFRESH_RETRY_MS = 6 * 60 * 60 * 1000;
const IGDB_PER_TICK = 10;
const KO_PER_TICK = kowiki.BATCH;
// A game Korean Wikipedia has nothing on is asked again after this.
export const KO_RETRY_MS = 30 * 24 * 60 * 60 * 1000;
const SHOTS_PER_TICK = 10;
const SHOT_RETRY_MS = 24 * 60 * 60 * 1000;
const PAUSE_MS = 300;

const shotTried = new Map(); // key → when its screenshots were last attempted
let running = null;
let refreshTriedAt = 0;
let shotIndex = null; // { dir, at, counts: Map(game folder → screenshots on disk) }

/** One game per key (variants that share a file name share the record). */
const uniqueByKey = (games) => [...new Map(games.map((g) => [metaKey(g), g])).values()];

/** What `prev` learned from Korean Wikipedia, kept on `fresh` while both name the same article. Pure. */
function koreanOf(prev, fresh) {
  if (!prev?.wiki || prev.wiki !== fresh.wiki) return {};
  if (prev.koFrom === "wikipedia" && prev.description?.ko) return { description: { ...fresh.description, ko: prev.description.ko }, koFrom: "wikipedia" };
  return prev.koTriedAt ? { koTriedAt: prev.koTriedAt } : {};
}

/**
 * The records after a LaunchBox rebuild: LaunchBox's (and MAME's) for what it
 * matched, with the Korean descriptions already found for them; IGDB's earlier
 * answers for the rest. Pure.
 */
export function mergeRecords(previous, fresh) {
  const kept = Object.fromEntries(Object.entries(previous).filter(([k, r]) => !fresh[k] && r?.source === "igdb"));
  const carried = Object.fromEntries(Object.entries(fresh).map(([k, r]) => [k, { ...r, ...koreanOf(previous[k], r) }]));
  return { ...kept, ...carried };
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
  if (games.length && !Object.keys(fresh).length) throw RetroError.of("meta.noMatch");
  const previous = store.all();
  const byKey = new Map(games.map((g) => [metaKey(g), g]));
  // A read far shorter than the last one is a cut-off file, not LaunchBox forgetting games:
  // keep the records and the screenshots as they are.
  const before = launchBoxCount(previous, byKey);
  const after = Object.keys(fresh).length;
  if (shrankTooMuch(before, after)) {
    debug.error("retro meta: LaunchBox matched %d games against %d last time; not applied", after, before);
    throw RetroError.of("meta.shrunk", { before, after });
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

/** Records with an English Wikipedia article, no Korean description yet, not asked lately. Pure. */
export function koDue(records, now, limit = KO_PER_TICK) {
  return Object.entries(records)
    .filter(([, r]) => r?.wiki && !r.description?.ko && !(now - (r.koTriedAt ?? -Infinity) < KO_RETRY_MS))
    .slice(0, limit);
}

/**
 * Looks a few games up on Korean Wikipedia and saves what it has. Stops at the
 * first failed request (the rest are asked next tick). Returns how many it settled.
 */
export async function koBatch({ fetchImpl = fetch, now = Date.now, pauseMs = PAUSE_MS } = {}) {
  const due = koDue(store.all(), now());
  if (!due.length) return 0;
  const titles = await kowiki.koreanTitles(due.map(([, r]) => r.wiki), { fetchImpl });
  const answers = {};
  for (const [key, r] of due) {
    const ko = titles.get(kowiki.canonicalTitle(r.wiki));
    let text = null;
    try {
      text = ko ? await kowiki.koreanSummary(ko, { fetchImpl }) : null;
    } catch (err) {
      debug.error("retro meta: Korean Wikipedia %s: %s", key, err.message);
      break;
    }
    const { koTriedAt: _tried, ...rest } = r;
    answers[key] = text ? { ...rest, description: { ...r.description, ko: text }, koFrom: "wikipedia" } : { ...r, koTriedAt: now() };
    if (ko) await pause(pauseMs);
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
export async function shotsBatch({ dir, games, systems, fetchImpl = fetch, now = Date.now, onStart = () => {} }) {
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
  if (due.length) onStart(due.map((g) => g.system));
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
 * a screenshot batch. `settings()` gives { on }; nothing runs while `on` is off.
 */
export async function tick({
  dir = env.retroDir, cacheDir = path.join(env.dataDir, "launchbox"), current, fetchImpl = fetch, now = Date.now,
  settings = () => ({ on: env.retroMeta }), pauseMs = PAUSE_MS,
} = {}) {
  if (running) return running;
  const { on } = settings();
  if (!on) return null;
  // The job appears with the first source asked: a tick with nothing to do never shows.
  let job = null;
  const touched = new Set();
  const at = (what, systemIds = []) => {
    job ??= activity.begin("retro-meta", { title: retroText(ACTIVITY_LANG, "meta.job") });
    for (const id of systemIds) touched.add(id);
    job.step(null, [what, systemNames(systemIds, lastSystems)].filter(Boolean).join(" · "));
  };
  let lastSystems = {};
  running = (async () => {
    const { games, systems } = await current();
    lastSystems = systems;
    if (!games.length) return { idle: true };
    if (now() - store.builtAt() >= REFRESH_AGE_MS && now() - refreshTriedAt >= REFRESH_RETRY_MS) {
      refreshTriedAt = now();
      at(retroText(ACTIVITY_LANG, "meta.stepLaunchbox"));
      return { launchbox: await refreshLaunchBox({ dir, cacheDir, games, systems, fetchImpl, now }) };
    }
    // IGDB only fills in after LaunchBox has had its say.
    const igdbNext = store.builtAt() ? igdbDue(games, store.all(), now()) : [];
    if (igdbNext.length) at(retroText(ACTIVITY_LANG, "meta.stepIgdb"), igdbNext.map((g) => g.system));
    const igdb = store.builtAt() ? await igdbBatch({ games, fetchImpl, now, pauseMs }) : 0;
    const koNext = store.builtAt() ? koDue(store.all(), now()) : [];
    if (koNext.length) at(retroText(ACTIVITY_LANG, "meta.stepKo"), koNext.map(([key]) => key.split("/")[0]));
    const ko = store.builtAt() ? await koBatch({ fetchImpl, now, pauseMs }) : 0;
    const shots = await shotsBatch({ dir, games, systems, fetchImpl, now, onStart: (ids) => at(retroText(ACTIVITY_LANG, "meta.stepShots"), ids) });
    const left = store.builtAt() ? igdbDue(games, store.all(), now(), Infinity).length + koDue(store.all(), now(), Infinity).length : 0;
    return { igdb, ko, shots, left };
  })()
    .then((r) => {
      if (r.launchbox !== undefined) job?.done(retroText(ACTIVITY_LANG, "meta.doneLaunchbox", { n: r.launchbox }));
      else if (job && (r.igdb || r.ko || r.shots)) job.done([tickSummary(r), systemNames([...touched], lastSystems)].filter(Boolean).join(" · "));
      else job?.discard();
      return r;
    }, (err) => { job?.fail(err); throw err; })
    .finally(() => { running = null; });
  return running;
}

/** "슈퍼 패미컴, 게임보이 어드밴스" for the systems a batch covers. Pure. */
export function systemNames(ids, systems = {}) {
  return [...new Set(ids)].map((id) => systems[id]?.names?.ko ?? systems[id]?.name ?? id).join(", ");
}

/** "한국어 설명 50개 · 스크린샷 31장 · 남은 2,310개": what one tick gathered, and what is left, in `lang`. Pure. */
export function tickSummary({ igdb, ko, shots, left = 0 }, lang = ACTIVITY_LANG) {
  const parts = [igdb && retroText(lang, "meta.igdb", { n: igdb }), ko && retroText(lang, "meta.ko", { n: ko }), shots && retroText(lang, "meta.shots", { n: shots })].filter(Boolean);
  if (left) parts.push(retroText(lang, "meta.left", { n: left.toLocaleString(lang === "zh" ? "zh-CN" : lang) }));
  return parts.join(" · ");
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
      else if (r?.shots || r?.igdb || r?.ko) debug.log("retro meta: %d asked of IGDB, %d of Korean Wikipedia, %d screenshots saved", r.igdb ?? 0, r.ko ?? 0, r.shots ?? 0);
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
