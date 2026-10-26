/**
 * Fetches, in the background, the pictures a game's own files do not carry (meta/art-fill.js says what shows
 * and in which order). For one base title lacking a slot, the sources are tried in order:
 *   1. titledb: iconUrl, bannerUrl, screenshots
 *   2. each active metadata plugin, in the registry's order: icon, banner, screenshots (plugins/agent-answer.js)
 * A slot is filled once, by the first source that has it. Every picture is downloaded through the
 * outbound guard (no private address, on any redirect hop either), cut down by art-ingest.js, which is
 * the only place a picture from outside is shrunk and kept, and written under data/art-fill/.
 *
 *   createArtFiller({ ...deps }) -> { start, want, track, settingChanged, status, idle, stop }
 *
 * Nothing here runs on a request path: want() and track() only queue, one title at a time, GAP_MS apart.
 * A title that has nothing to fetch is asked again after MISS_MS, one whose download failed after a
 * day (doubling with each failure, two weeks at most), unless what the sources offer changed since
 * (a titledb reload, a plugin's new answer). With the admin setting off, nothing is queued or fetched.
 */
import * as defaultFill from "./art-fill.js";
import * as customArt from "./custom-art.js";
import * as titledbStore from "./titledb-store.js";
import { ART, MAX_INPUT_BYTES, fetchImage, ingest } from "./art-ingest.js";
import { cachePathFor, hasCached, baseTitleIdOf } from "./image-cache.js";
import { guardedFetch } from "../security/outbound-guard.js";
import { MAX_SHOTS, ART_FIELDS } from "../plugins/agent-answer.js";
import { agentParts } from "../plugins/instance.js";
import * as libraryCache from "./library-cache.js";
import debug from "../debug.js";

const DAY_MS = 24 * 3600_000;
export const MISS_MS = 7 * DAY_MS;
export const FAIL_MS = DAY_MS;
export const FAIL_MAX_MS = 14 * DAY_MS;
export const GAP_MS = 300;
export const QUEUE_MAX = 20_000;
const FETCH_TIMEOUT_MS = 30_000;
const MAX_PICTURE_BYTES = Math.min(MAX_INPUT_BYTES, 16 * 1024 * 1024);
const CHANGE_DEBOUNCE_MS = 2_000;
const ID_RE = /^[0-9A-F]{16}$/;

const isUrl = (v) => typeof v === "string" && /^https?:\/\/\S{1,500}$/.test(v);

/** What titledb offers for a title: { icon?, banner?, screenshots: [] }. */
function titledbOffer(entry) {
  return {
    icon: isUrl(entry?.iconUrl) ? entry.iconUrl : null,
    banner: isUrl(entry?.bannerUrl) ? entry.bannerUrl : null,
    screenshots: Array.isArray(entry?.screenshots) ? entry.screenshots.filter(isUrl).slice(0, MAX_SHOTS) : [],
  };
}

/** What a plugin's answer offers (https only; agent-answer.js already checked its shape). */
function pluginOffer(fields) {
  const https = (v) => (typeof v === "string" && v.startsWith("https://") ? v : null);
  return {
    icon: https(fields?.icon),
    banner: https(fields?.banner),
    screenshots: Array.isArray(fields?.screenshots) ? fields.screenshots.filter((v) => https(v)).slice(0, MAX_SHOTS) : [],
  };
}

const defaultPlugins = {
  /** [{ id, entry }] for each active metadata plugin, its kept answer loaded. */
  async ready() {
    const { registry, store } = agentParts();
    await Promise.all(registry.activeProviding("metadata").map((id) => store.load(id)));
  },
  list(base) {
    const { registry, store } = agentParts();
    return registry.activeProviding("metadata").map((id) => ({ id, entry: store.get(id, base) }));
  },
};

export function createArtFiller({
  fill = defaultFill,
  titledb = (base) => titledbStore.get(base),
  plugins = defaultPlugins,
  fetchImpl = (url, options) => guardedFetch(url, options),
  ingestImpl = ingest,
  hasFileIcon = (base) => hasCached(cachePathFor(base, "icon")),
  onChange = () => libraryCache.invalidate(),
  now = Date.now,
  gapMs = GAP_MS,
  changeMs = CHANGE_DEBOUNCE_MS,
  log = (m) => debug.log("art-fill: %s", m),
} = {}) {
  const queue = new Set();
  const known = new Set();
  let running = null;
  let started = false;
  let stopped = false;
  let changeTimer = null;

  /** Which slots are empty: the admin's, the game file's and an earlier fill all count as filled. */
  function needed(base) {
    const own = customArt.list(base);
    const file = hasFileIcon(base);
    return {
      icon: !own.icon && !file && !fill.kept(base, "icon"),
      banner: !own.banner && !own.icon && !file && !fill.kept(base, "banner"),
      shots: own.screens.length === 0 && !fill.kept(base, "screenshot", 0),
    };
  }
  const anyNeed = (n) => n.icon || n.banner || n.shots;

  /** What the sources offer now, as a string: a change in it lets a title that missed be tried again. */
  function offerStamp(base) {
    const o = titledbOffer(titledb(base));
    const pluginPart = plugins.list(base)
      .filter((p) => p.entry && !p.entry.miss && ART_FIELDS.some((f) => p.entry.fields?.[f]))
      .map((p) => `${p.id}:${p.entry.at}`)
      .join(",");
    return `${o.icon ?? ""}|${o.banner ?? ""}|${o.screenshots.length}|${pluginPart}`;
  }

  function changed() {
    clearTimeout(changeTimer);
    changeTimer = setTimeout(() => {
      try { onChange(); } catch (err) { log(`change callback failed: ${err.message}`); }
    }, changeMs);
    changeTimer.unref?.();
  }

  async function download(url, kind, base, idx, got, label) {
    const spec = ART[kind === "screenshot" ? "screenshot" : kind];
    const dest = fill.fillPath(base, kind, idx);
    const input = await fetchImage(url, { fetchImpl, maxBytes: MAX_PICTURE_BYTES, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    await ingestImpl({ input, spec, dest, maxBytes: MAX_PICTURE_BYTES });
    fill.noteWritten(dest);
    if (kind === "screenshot") (got.screens ??= [])[idx] = label;
    else got[kind] = label;
  }

  async function process(base) {
    const need = needed(base);
    if (!anyNeed(need)) return;
    await plugins.ready?.();
    const before = fill.recordOf(base);
    const got = { ...(before?.got ?? {}), screens: [...(before?.got?.screens ?? [])] };
    const sources = [
      { label: "titledb", offer: titledbOffer(titledb(base)) },
      ...plugins.list(base)
        .filter((p) => p.entry && !p.entry.miss)
        .map((p) => ({ label: `plugin:${p.id}`, offer: pluginOffer(p.entry.fields) })),
    ];
    let failed = 0;
    let arrived = false;
    for (const { label, offer } of sources) {
      if (stopped || !fill.enabled()) return;
      for (const kind of ["icon", "banner"]) {
        if (!need[kind] || !offer[kind]) continue;
        try {
          await download(offer[kind], kind, base, 0, got, label);
          need[kind] = false;
          arrived = true;
        } catch (err) {
          failed++;
          log(`${base} ${kind} from ${label}: ${err.message}`);
        }
        await pause();
      }
      if (need.shots && offer.screenshots.length) {
        let n = 0;
        for (const url of offer.screenshots) {
          if (stopped || !fill.enabled()) return;
          try {
            await download(url, "screenshot", base, n, got, label);
            n++;
          } catch (err) {
            failed++;
            log(`${base} screenshot from ${label}: ${err.message}`);
          }
          await pause();
        }
        if (n) { need.shots = false; arrived = true; }
      }
    }
    // A banner nobody offers is no miss: it is drawn from the icon.
    const missing = need.icon || need.shots;
    const fails = failed ? (before?.fails ?? 0) + 1 : 0;
    const retry = failed ? now() + Math.min(FAIL_MS * 2 ** (fails - 1), FAIL_MAX_MS) : missing ? now() + MISS_MS : 0;
    fill.setRecord(base, { at: now(), retry, fails, stamp: offerStamp(base), got });
    if (arrived) changed();
  }

  const pause = () => (gapMs > 0 ? new Promise((r) => setTimeout(r, gapMs)) : Promise.resolve());

  async function pump() {
    if (running) return running;
    running = (async () => {
      try {
        while (!stopped && queue.size) {
          if (!fill.enabled()) { queue.clear(); break; }
          const [base] = queue;
          queue.delete(base);
          try {
            await process(base);
          } catch (err) {
            log(`${base}: ${err.message}`);
          }
        }
      } finally {
        running = null;
      }
    })();
    return running;
  }

  function want(raw) {
    const base = baseTitleIdOf(String(raw ?? "").toUpperCase());
    if (!ID_RE.test(base)) return;
    // Remembered even before start(), so a scan that ran first is looked at once the filler starts.
    known.add(base);
    if (!started || stopped || !fill.enabled()) return;
    if (queue.has(base) || queue.size >= QUEUE_MAX) return;
    if (!anyNeed(needed(base))) return;
    const rec = fill.recordOf(base);
    if (rec?.retry > now() && rec.stamp === offerStamp(base)) return;
    queue.add(base);
    setImmediate(() => { pump(); });
  }

  return {
    start() {
      started = true;
      stopped = false;
      fill.setWanter(want);
      for (const base of [...known]) want(base);
    },
    want,
    /** Titles after a scan: games, their updates and DLC, and the games patches are for (each folds to its game). */
    track(ids) {
      for (const id of ids) want(id);
    },
    /** The admin turned the setting on or off: on, everything known is looked at again. */
    settingChanged() {
      if (fill.enabled()) for (const base of [...known]) want(base);
      else queue.clear();
    },
    /** For the admin: how many titles got pictures from outside, and how many tracked games still have no icon at all. */
    status() {
      const c = fill.counts();
      let missing = 0;
      for (const base of known) {
        if (!customArt.hasOverride(base, "icon") && !hasFileIcon(base) && !fill.filled(base, "icon")) missing++;
      }
      return { enabled: fill.enabled(), titledb: c.titledb, plugin: c.plugin, files: c.files, tracked: known.size, missing, queued: queue.size };
    },
    /** Resolves when the queue is empty (tests). */
    async idle() {
      while (running || queue.size) await (running ?? pump());
    },
    stop() {
      stopped = true;
      queue.clear();
      clearTimeout(changeTimer);
      fill.flush();
    },
  };
}

let shared = null;
/** The one filler the server runs. It does nothing until start() (the server's boot), so tests that load titledb never fetch. */
export const artFiller = () => (shared ??= createArtFiller());
