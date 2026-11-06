/**
 * Firmware releases followed from a GitHub repository (the firmwareRepo setting,
 * empty by default: then nothing here runs and no firmware is offered).
 *
 * The list a console reads is kept on disk (data/firmware/state.json) and only
 * ever grows from a good answer. A failed check (no network, 403/429, the
 * repository gone, an empty answer, or one listing fewer than half the versions
 * known) keeps it as it is and only records that the source did not answer, and
 * when. A version the source stops listing stays: available while the server
 * holds its zip, else available false with reason "upstream_gone".
 *
 * Only the server asks GitHub, on its timer (firmwareHours) and when the source
 * setting changes; a console's request never does, except that downloading a
 * version not cached yet fetches that one zip. Zips are fetched one at a time
 * into data/firmware/cache/<version>.zip: written beside it with its sha256
 * taken on the way, checked (firmware/archive.js, the asset's size, GitHub's
 * digest when it gives one) and only then renamed into place. A zip that fails
 * the check is deleted and its version marked bad_archive until the next check.
 * Cached zips are keyed by version and their checked contents, so they outlive
 * a change of source. Keep mode "latest" fetches the newest version after each
 * check, "all" every one missing.
 */
import fs from "fs";
import path from "path";
import debug from "../debug.js";
import { digestHex } from "../meta/client-release.js";
import { ArchiveError, fileDirectory, fileSha256, firmwareProblem, remoteDirectory, summarize } from "./archive.js";
import { downloadAsset, fetchRange, listReleases } from "./github.js";
import { VERSION_RE, isSource, mergeUpstream, newestFirst, shrinkProblem, upstreamVersions } from "./versions.js";
import { adminVersions, listView } from "./view.js";

// A version whose fetch failed (not a bad zip) is not tried again sooner than this.
export const FETCH_RETRY_MS = 60_000;
// Free space kept on top of a zip's own size before it is fetched.
export const SPACE_MARGIN = 1024 ** 3;
const HOUR_MS = 60 * 60_000;

const onlyVersions = (o) => Object.fromEntries(Object.entries(o && typeof o === "object" ? o : {}).filter(([v]) => VERSION_RE.test(v)));

async function statfsFree(dir) {
  const st = await fs.promises.statfs(dir);
  return st.bavail * st.bsize;
}

/**
 * dir         where state.json and cache/ live (data/firmware)
 * repo()      the "owner/name" followed, "" for none
 * keep()      "latest" or "all"
 * hours()     how many hours between checks
 * token()     an optional GitHub token
 * freeBytes(dir), fetchImpl, now: the disk, the network and the clock, for tests
 */
export function createFirmware({ dir, repo, keep = () => "latest", hours = () => 6, token = () => null, fetchImpl = fetch, now = Date.now, freeBytes = statfsFree }) {
  const stateFile = path.join(dir, "state.json");
  const cacheDir = path.join(dir, "cache");
  const zipPath = (version) => path.join(cacheDir, `${version}.zip`);
  let state = null;
  let refreshing = null;
  let timer = null;
  let nextAt = null;
  const queue = []; // [{ version, adopt }], fetched in order
  let fetching = null; // { version, bytes, size }
  let working = null;
  let tidied = false;
  const failed = new Map(); // version -> { at, kind, message }: fetches that went wrong (in memory only)

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
      cached: onlyVersions(s.cached),
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
  const setVersion = (version, patch) => {
    const s = load();
    if (s.versions[version]) state = { ...s, versions: { ...s.versions, [version]: { ...s.versions[version], ...patch } } };
  };
  const setCached = (version, record) => {
    const s = load();
    const { [version]: _gone, ...rest } = s.cached;
    state = { ...s, cached: record ? { ...rest, [version]: record } : rest };
  };

  // Whether the source answered at its last check, and when; another source than the one set has not been asked yet.
  const checkOf = (name) => (load().check?.source === name ? load().check : null);

  /** GET /api/firmware: the source and every version, newest first. */
  function list() {
    const name = repo();
    return listView(load(), name, checkOf(name));
  }

  // ── the check ─────────────────────────────────────────────────────────
  function unreachable(name, kind, message) {
    // The list stays as it is: only whether the source answered, and when, change. A source that is gone
    // (not_found) can not hand out what the cache lacks, so those versions read as gone upstream until it answers again.
    const s = load();
    const versions = kind === "not_found" && s.listed_from === name ? Object.fromEntries(Object.entries(s.versions).map(([v, e]) => [v, { ...e, upstream: false }])) : s.versions;
    state = { ...s, versions, check: { source: name, reachable: false, at: now(), error: { kind, message } } };
    save();
    debug.error("firmware: %s did not give a list to use (%s): %s", name, kind, message);
  }

  /** The directory of each listed zip not read yet, from its tail; one at a time. */
  async function readDirectories(name) {
    for (const version of newestFirst(Object.keys(load().versions))) {
      const e = load().versions[version];
      if (!e.upstream || e.dir_hash || load().cached[version]) continue;
      if (repo() !== name) return;
      try {
        const entries = await remoteDirectory((start, end) => fetchRange({ url: e.asset.url, start, end, size: e.asset.size, fetchImpl }), e.asset.size);
        const problem = firmwareProblem(entries);
        setVersion(version, problem ? { bad: { message: problem, at: now() } } : summarize(entries));
      } catch (err) {
        // A zip that reads wrong is bad; a network hiccup leaves it unread (files 0) for the next check.
        if (err instanceof ArchiveError) setVersion(version, { bad: { message: err.message, at: now() } });
        else debug.error("firmware: could not read the directory of %s: %s", version, err.message);
      }
    }
    save();
  }

  async function runRefresh() {
    const name = repo();
    if (!isSource(name)) return;
    if (!tidied) {
      tidied = true;
      try {
        tidy();
      } catch (err) {
        debug.error("firmware: could not tidy the cache: %s", err.message);
      }
    }
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
      versions: mergeUpstream(load().versions, upstream, { sameSource: same, cached: load().cached }),
      check: { source: name, reachable: true, at: now(), error: null },
    };
    save();
    await readDirectories(name);
    queuePrefetch();
  }

  /** Reads the release list now (one check at a time); resolves when the list and the zip directories are read. */
  function refresh() {
    refreshing ??= runRefresh()
      .catch((err) => debug.error("firmware: check failed: %s", err.message))
      .finally(() => { refreshing = null; });
    return refreshing;
  }

  // ── the cache ─────────────────────────────────────────────────────────
  const queued = (version) => fetching?.version === version || queue.some((j) => j.version === version);

  function kick() {
    working ??= (async () => {
      while (queue.length) {
        const job = queue.shift();
        try {
          await (job.adopt ? adopt(job.version) : fetchOne(job.version));
        } catch (err) {
          debug.error("firmware: %s: %s", job.version, err.message);
        }
      }
    })().finally(() => {
      working = null;
      if (queue.length) kick();
    });
  }
  function enqueue(version, { adopt: isAdopt = false } = {}) {
    if (queued(version)) return;
    queue.push({ version, adopt: isAdopt });
    kick();
  }

  /** The newest version (keep "latest") or every one (keep "all") the source lists and the cache lacks. */
  function queuePrefetch() {
    const s = load();
    const listed = newestFirst(Object.keys(s.versions).filter((v) => s.versions[v].upstream));
    for (const version of keep() === "all" ? listed : listed.slice(0, 1)) {
      if (!s.cached[version] && !s.versions[version].bad) enqueue(version);
    }
  }

  /** Why there is no room for `size` more bytes, or null when there is. */
  async function spaceProblem(size) {
    await fs.promises.mkdir(cacheDir, { recursive: true });
    const free = await freeBytes(cacheDir);
    return free < size + SPACE_MARGIN ? `${size} bytes plus a margin of ${SPACE_MARGIN} are needed, ${free} are free` : null;
  }

  async function fetchOne(version) {
    const e = load().versions[version];
    if (load().cached[version] || !e?.upstream || e.bad || !isSource(repo())) return;
    const last = failed.get(version);
    if (last && now() - last.at < FETCH_RETRY_MS) return;
    const short = await spaceProblem(e.asset.size);
    if (short) {
      failed.set(version, { at: now(), kind: "no_space", message: short });
      return debug.error("firmware: not fetching %s: %s", version, short);
    }
    const dest = zipPath(version);
    const part = `${dest}.part`;
    fetching = { version, bytes: 0, size: e.asset.size };
    try {
      const sha256 = await downloadAsset({ url: e.asset.url, dest: part, size: e.asset.size, fetchImpl, onBytes: (n) => { fetching.bytes = n; } });
      const want = digestHex(e.asset.digest);
      if (want && want !== sha256) throw new ArchiveError("the zip's sha256 is not the one GitHub gives");
      const entries = await fileDirectory(part);
      const problem = firmwareProblem(entries, e);
      if (problem) throw new ArchiveError(problem);
      await fs.promises.rename(part, dest);
      setCached(version, { sha256, size: e.asset.size, ...summarize(entries), released: e.released, at: now() });
      failed.delete(version);
      debug.log("firmware: %s is cached", version);
    } catch (err) {
      await fs.promises.rm(part, { force: true }).catch(() => {});
      if (err.kind === "not_found") {
        // The asset went since the list was read: gone upstream, so a console stops waiting for it.
        setVersion(version, { upstream: false });
        debug.error("firmware: %s is gone from the source: %s", version, err.message);
      } else if (err instanceof ArchiveError || err.kind === "size") {
        setVersion(version, { bad: { message: err.message, at: now() } });
        debug.error("firmware: %s is not a firmware zip to hand out: %s", version, err.message);
      } else {
        failed.set(version, { at: now(), kind: err.kind ?? "error", message: err.message });
        debug.error("firmware: fetching %s failed: %s", version, err.message);
      }
    } finally {
      fetching = null;
      save();
    }
  }

  /** A zip found in the cache with no record (the state file was lost): kept when it checks out, else deleted. */
  async function adopt(version) {
    const abs = zipPath(version);
    try {
      const entries = await fileDirectory(abs);
      const problem = firmwareProblem(entries);
      if (problem) throw new ArchiveError(problem);
      const { size } = await fs.promises.stat(abs);
      setCached(version, { sha256: await fileSha256(abs), size, ...summarize(entries), released: load().versions[version]?.released ?? "", at: now() });
      save();
    } catch (err) {
      if (!(err instanceof ArchiveError)) throw err;
      await fs.promises.rm(abs, { force: true });
      debug.error("firmware: deleted %s from the cache: %s", version, err.message);
    }
  }

  /** At start: half-written files go, records whose zip is gone or changed size go, zips without a record are checked. */
  function tidy() {
    fs.mkdirSync(cacheDir, { recursive: true });
    const files = new Map();
    for (const name of fs.readdirSync(cacheDir)) {
      const abs = path.join(cacheDir, name);
      if (name.endsWith(".part")) fs.rmSync(abs, { force: true });
      const m = /^(.+)\.zip$/.exec(name);
      if (m && VERSION_RE.test(m[1])) files.set(m[1], fs.statSync(abs).size);
    }
    let changed = false;
    for (const [version, record] of Object.entries(load().cached)) {
      if (files.get(version) === record.size) continue;
      setCached(version, null);
      changed = true;
    }
    if (changed) save();
    for (const version of files.keys()) if (!load().cached[version]) enqueue(version, { adopt: true });
  }

  /**
   * What a download of `version` gets now: { state: "ready", path, sha256, size }, "caching" (its fetch
   * is queued or running), "unknown", "unavailable" with a reason, or "no_space".
   */
  async function prepare(version) {
    if (!VERSION_RE.test(version)) return { state: "unknown" };
    const c = load().cached[version];
    if (c) {
      const abs = zipPath(version);
      const st = await fs.promises.stat(abs).catch(() => null);
      if (st?.isFile() && st.size === c.size) return { state: "ready", path: abs, sha256: c.sha256, size: c.size };
      // The file went: the version is fetched again like one never cached.
      setCached(version, null);
      save();
    }
    const e = load().versions[version];
    if (!e) return { state: "unknown" };
    if (e.bad) return { state: "unavailable", reason: "bad_archive" };
    if (!e.upstream) return { state: "unavailable", reason: "upstream_gone" };
    if (!queued(version)) {
      const short = await spaceProblem(e.asset.size);
      if (short) return { state: "no_space", message: short };
      enqueue(version);
    }
    return { state: "caching", bytes: fetching?.version === version ? fetching.bytes : 0, size: e.asset.size };
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

  /** Checks the source after `delayMs` (tidying the cache first), then every firmwareHours. Nothing while no source is set. */
  function start({ delayMs = 5_000 } = {}) {
    clearTimeout(timer);
    if (!isSource(repo())) return;
    nextAt = now() + delayMs;
    timer = setTimeout(() => refresh().finally(schedule), delayMs);
    timer.unref?.();
  }

  /** After the admin saved settings: a new source is asked at once, a new interval or keep mode applies now. */
  function settingsChanged(changed) {
    if (changed.includes("firmwareRepo")) {
      // Fetches queued for the old source go; one already running finishes.
      queue.length = 0;
      refresh().finally(schedule);
      return;
    }
    if (changed.includes("firmwareHours")) schedule();
    if (changed.includes("firmwareKeep")) queuePrefetch();
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
    const cachedVersions = Object.values(s.cached);
    return {
      source: name || null,
      enabled: isSource(name),
      keep: keep(),
      hours: hours(),
      reachable: Boolean(check?.reachable),
      checked_at: check?.at ?? null,
      error: check?.error ?? null,
      next_check: nextAt,
      checking: Boolean(refreshing),
      fetching: fetching ? { ...fetching } : null,
      queued: queue.filter((j) => !j.adopt).map((j) => j.version),
      failed: [...failed].map(([version, f]) => ({ version, ...f })),
      cache: { count: cachedVersions.length, bytes: cachedVersions.reduce((n, c) => n + c.size, 0) },
      versions: adminVersions(s),
    };
  }

  /** Waits for the check and the fetches under way (tests). */
  async function idle() {
    while (refreshing || working) await (refreshing ?? working);
  }

  const stop = () => {
    clearTimeout(timer);
    timer = null;
  };

  return { enabled: () => isSource(repo()), list, refresh, refreshNow, prepare, status, start, stop, tidy, settingsChanged, idle };
}
