/**
 * Firmware releases followed from a GitHub repository (the firmwareRepo setting,
 * empty by default: then nothing here runs and no firmware is offered).
 *
 * The server keeps only the list (data/firmware/state.json): each version's
 * release date and the address, size and digest of its zip at the source. A
 * console downloads from the source itself; nothing is fetched or stored here,
 * so the server never hands out a firmware file of its own.
 *
 * The list only ever grows from a good answer. A failed check (no network,
 * 403/429, the repository gone, an empty answer, or one listing fewer than half
 * the versions known) keeps it as it is and only records that the source did
 * not answer, and when. A version the source stops listing stays, available
 * false with reason "upstream_gone", until the source lists it again.
 *
 * Only the server asks GitHub, on its timer (firmwareHours) and when the source
 * setting changes; a console's request never does.
 */
import fs from "fs";
import path from "path";
import debug from "../debug.js";
import { listReleases } from "./github.js";
import { VERSION_RE, isSource, mergeUpstream, shrinkProblem, upstreamVersions } from "./versions.js";
import { adminVersions, listView } from "./view.js";

const HOUR_MS = 60 * 60_000;

const onlyVersions = (o) => Object.fromEntries(Object.entries(o && typeof o === "object" ? o : {}).filter(([v]) => VERSION_RE.test(v)));

/**
 * dir         where state.json lives (data/firmware)
 * repo()      the "owner/name" followed, "" for none
 * hours()     how many hours between checks
 * token()     an optional GitHub token
 * fetchImpl, now: the network and the clock, for tests
 */
export function createFirmware({ dir, repo, hours = () => 6, token = () => null, fetchImpl = fetch, now = Date.now }) {
  const stateFile = path.join(dir, "state.json");
  const cacheDir = path.join(dir, "cache");
  let state = null;
  let refreshing = null;
  let timer = null;
  let nextAt = null;

  function load() {
    if (state) return state;
    let s = {};
    try {
      s = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    } catch {
      s = {};
    }
    state = {
      listed_from: typeof s.listed_from === "string" ? s.listed_from : null,
      pages: Array.isArray(s.pages) ? s.pages : [],
      versions: onlyVersions(s.versions),
      check: s.check && typeof s.check === "object" ? s.check : null,
    };
    return state;
  }
  function save() {
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(`${stateFile}.tmp`, JSON.stringify(state));
      fs.renameSync(`${stateFile}.tmp`, stateFile);
    } catch (err) {
      debug.error("firmware: could not save the list: %s", err.message);
    }
  }

  // Whether the source answered at its last check, and when; another source than the one set has not been asked yet.
  const checkOf = (name) => (load().check?.source === name ? load().check : null);

  /** GET /api/firmware: the source and every version, newest first. */
  function list() {
    const name = repo();
    return listView(load(), name, checkOf(name));
  }

  /** Zips an older build fetched into data/firmware/cache go: the server keeps no firmware file. */
  function tidy() {
    if (!fs.existsSync(cacheDir)) return false;
    fs.rmSync(cacheDir, { recursive: true, force: true });
    debug.log("firmware: removed the cache of zips an older build kept");
    return true;
  }

  // ── the check ─────────────────────────────────────────────────────────
  function unreachable(name, kind, message) {
    // The list stays as it is: only whether the source answered, and when, change. A source that is gone
    // (not_found) lists nothing any more, so its versions read as gone upstream until it answers again.
    const s = load();
    const versions = kind === "not_found" && s.listed_from === name ? Object.fromEntries(Object.entries(s.versions).map(([v, e]) => [v, { ...e, upstream: false }])) : s.versions;
    state = { ...s, versions, check: { source: name, reachable: false, at: now(), error: { kind, message } } };
    save();
    debug.error("firmware: %s did not give a list to use (%s): %s", name, kind, message);
  }

  async function runRefresh() {
    const name = repo();
    if (!isSource(name)) return;
    const s = load();
    const same = s.listed_from === name;
    let answer;
    try {
      answer = await listReleases({ repo: name, kept: same ? s.pages : [], token: token(), fetchImpl });
    } catch (err) {
      return unreachable(name, err.kind ?? "network", err.message);
    }
    if (repo() !== name) return;
    const upstream = upstreamVersions(answer.releases);
    const problem = shrinkProblem(upstream, s.versions, same);
    if (problem) return unreachable(name, upstream.size ? "shrunk" : "empty", problem);
    state = {
      ...load(),
      listed_from: name,
      pages: answer.pages,
      versions: mergeUpstream(load().versions, upstream, { sameSource: same }),
      check: { source: name, reachable: true, at: now(), error: null },
    };
    save();
  }

  /** Reads the release list now (one check at a time). */
  function refresh() {
    refreshing ??= runRefresh()
      .catch((err) => debug.error("firmware: check failed: %s", err.message))
      .finally(() => { refreshing = null; });
    return refreshing;
  }

  // ── the timer ─────────────────────────────────────────────────────────
  function schedule() {
    clearTimeout(timer);
    timer = null;
    nextAt = null;
    if (!isSource(repo())) return;
    const ms = Math.max(1, hours()) * HOUR_MS;
    nextAt = now() + ms;
    timer = setTimeout(() => refresh().finally(schedule), ms);
    timer.unref?.();
  }

  /** Drops any cached zips, then checks the source after `delayMs` and every firmwareHours. Nothing while no source is set. */
  function start({ delayMs = 5_000 } = {}) {
    try {
      tidy();
    } catch (err) {
      debug.error("firmware: could not remove the old cache: %s", err.message);
    }
    clearTimeout(timer);
    if (!isSource(repo())) return;
    nextAt = now() + delayMs;
    timer = setTimeout(() => refresh().finally(schedule), delayMs);
    timer.unref?.();
  }

  /** After the admin saved settings: a new source is asked at once, a new interval applies now. */
  function settingsChanged(changed) {
    if (changed.includes("firmwareRepo")) {
      refresh().finally(schedule);
      return;
    }
    if (changed.includes("firmwareHours")) schedule();
  }

  /** Starts a check in the background; false when one was already running. */
  function refreshNow() {
    if (!isSource(repo())) return false;
    const already = Boolean(refreshing);
    refresh().finally(schedule);
    return !already;
  }

  /** What the admin page and the firmware capability show. */
  function status() {
    const s = load();
    const name = repo();
    const check = checkOf(name);
    return {
      source: name || null,
      enabled: isSource(name),
      hours: hours(),
      reachable: Boolean(check?.reachable),
      checked_at: check?.at ?? null,
      error: check?.error ?? null,
      next_check: nextAt,
      checking: Boolean(refreshing),
      versions: adminVersions(s),
    };
  }

  /** Waits for the check under way (tests). */
  async function idle() {
    while (refreshing) await refreshing;
  }

  const stop = () => {
    clearTimeout(timer);
    timer = null;
  };

  return { enabled: () => isSource(repo()), list, refresh, refreshNow, status, start, stop, tidy, settingsChanged, idle };
}
