/**
 * The plugin registry: which plugins exist, which are switched on, how each is behaving, and the one
 * way to call into them. The rule it keeps: a plugin cannot stop the server from starting, the shop
 * from listing, or a download from being served. A plugin that is missing, off, slow or broken gives
 * the same result as no plugin.
 *
 *   createRegistry(deps) -> registry
 *   registry.init()                         scan, apply crash marks, start what is switched on (sequential,
 *                                           so the caller does not await it before listening)
 *   registry.list()                         every plugin as the admin page shows it (see view())
 *   registry.setEnabled(id, on, { confirmKeys })
 *   registry.callHook(id, kind, args, { lang, clientVersion, console })   never throws: { value } | { skipped } | { error }
 *   registry.rescan() / startWatching()     folders appearing and disappearing, without a restart
 *   registry.trash(id, opts) / listTrashed() / restore(name)
 *   registry.recordVariantKeys(id, keys) / variantKeyStatus(key)
 *   registry.stopAll()
 *
 * States: off, starting, on, cooling, failed, auto-disabled, crash-disabled, broken, incompatible, missing.
 * Hooks are never called on the request path of the shop or a download: metadata and art run in the
 * background and are cached (stage 2). A variant plan runs while a file is sent, so its failure is a
 * plain { error } the sender turns into the original refusal, never a thrown error.
 */
import fsp from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { scanPluginDir, ENTRY_FILE } from "./loader.js";
import { API_VERSION } from "./manifest.js";
import { firstLine, runInPlugin } from "./guard.js";
import { createMarkers, createPluginStore } from "./state.js";
import { makeCtx } from "./context.js";

export const MINUTE_MS = 60_000;
export const DEFAULT_LIMITS = Object.freeze({
  startMs: 10_000,
  stopMs: 5_000,
  hookMs: Object.freeze({ metadata: 15_000, art: 15_000, variants: 5_000, plan: 30_000, tasks: 5_000, shopInfo: 2_000 }),
  hookMsDefault: 15_000,
  startFailLimit: 3,
  hookFailLimit: 5,
  cooldownMinutes: Object.freeze([10, 20, 40, 60]),
  rescanMs: 5_000,
});

/** The hook functions each `provides` entry obliges a plugin to export. */
export const HOOKS_OF = Object.freeze({ metadata: ["metadata"], art: ["art"], variant: ["variants", "plan"], task: ["tasks"] });

/** Hooks that only decorate a listing: a failure of one does not count toward a pause. */
const LISTING_HOOKS = new Set(["variants"]);

const readOnlyCopies = new WeakMap();

/**
 * A copy of the parsed keys a plugin may read but not change, and that is not the server's own Map.
 * One copy per source Map: the same prod.keys always arrives as the same object, so a plugin can
 * tell by identity that nothing changed and keep what it worked out from them.
 */
function readOnlyKeys(keys) {
  if (!(keys instanceof Map)) return null;
  const kept = readOnlyCopies.get(keys);
  if (kept) return kept;
  const copy = new Map(keys);
  const refuse = () => { throw new TypeError("keys are read-only"); };
  copy.set = refuse;
  copy.delete = refuse;
  copy.clear = refuse;
  readOnlyCopies.set(keys, Object.freeze(copy));
  return readOnlyCopies.get(keys);
}

/** The hooks of a plugin that said needsKeys are handed the parsed prod.keys, for that call only. */
const KEYED_HOOKS = new Set(["plan", "variants", "shopInfo"]);

// Module-wide: a second registry (a test, a reload) must not import a URL the first one already cached.
let importCount = 0;

const TRASH_NAME_RE = /^([a-z0-9][a-z0-9-]{0,39})\.(\d{10,16})$/;
const TRASH_META_BY = "plugin-registry";

export class PluginError extends Error {
  constructor(code, status = 409) {
    super(code);
    this.name = "PluginError";
    this.code = code;
    this.status = status;
  }
}

/** Rename, falling back to copy and remove across disks. */
async function moveDir(from, to) {
  try {
    await fsp.rename(from, to);
  } catch (err) {
    if (err?.code !== "EXDEV") throw err;
    await fsp.cp(from, to, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
    await fsp.rm(from, { recursive: true, force: true });
  }
}

export function createRegistry({
  db, dataDir, now = Date.now, limits = {}, safeMode = false, notify = () => {}, debug,
  settingsOf, keysReader, keysProvider, fetchImpl, clearSettings, importPlugin = (file) => import(file),
}) {
  const lim = { ...DEFAULT_LIMITS, ...limits, hookMs: { ...DEFAULT_LIMITS.hookMs, ...(limits.hookMs ?? {}) } };
  const root = path.join(dataDir, "plugins");
  const trashRoot = path.join(dataDir, "plugins-trash");
  const store = createPluginStore(db, now);
  const markers = createMarkers(dataDir);
  const entries = new Map(); // id -> scan entry
  const running = new Map(); // id -> { state: "starting" | "on" | "failed", instance }
  const missing = new Set();
  const capabilities = new Map();
  let queue = Promise.resolve();
  let watcher = null;

  /** State-changing operations run one at a time. */
  const locked = (fn) => {
    const next = queue.then(fn, fn);
    queue = next.catch(() => {});
    return next;
  };
  const log = (level, msg) => debug?.[level]?.(`plugins: ${msg}`);

  const disable = (id, reason, message) => {
    store.update(id, { enabled: false, disabledReason: reason, disabledAt: now(), ...(message ? { lastError: message, lastErrorAt: now() } : {}) });
    notify({ id, event: reason === "start-failed" ? "auto-disabled" : "crash-disabled", reason, message: message ?? "" });
  };

  /** A plugin that is not running offers no tools. */
  function dropCapabilities(id) {
    for (const [capId, def] of capabilities) if (def.plugin === id) capabilities.delete(capId);
  }

  async function stopInstance(id) {
    const rt = running.get(id);
    running.delete(id);
    dropCapabilities(id);
    if (!rt?.instance || typeof rt.instance.stop !== "function") return;
    const r = await runInPlugin(id, () => rt.instance.stop(), { timeoutMs: lim.stopMs });
    if (!r.ok) log("warn", `${id}: stop failed: ${firstLine(r.error)}`);
  }

  function contractProblem(manifest, instance) {
    for (const kind of manifest.provides) {
      for (const fn of HOOKS_OF[kind]) if (typeof instance[fn] !== "function") return `missing-hook-${fn}`;
    }
    return null;
  }

  async function start(id) {
    const entry = entries.get(id);
    if (entry?.status !== "ok") return;
    running.set(id, { state: "starting", instance: null });
    markers.markBooting(id);
    // A start that outlives its time limit is abandoned: if it ends later, its instance is stopped and
    // what it registered is ignored, so a second switch-on never leaves two live instances.
    const attempt = { dead: false };
    const r = await runInPlugin(id, async () => {
      const url = `${pathToFileURL(path.join(entry.dir, ENTRY_FILE)).href}?v=${++importCount}`;
      const mod = await importPlugin(url);
      const instance = mod?.default;
      if (!instance || (typeof instance !== "object" && typeof instance !== "function")) throw new Error("no-default-export");
      const bad = contractProblem(entry.manifest, instance);
      if (bad) throw new Error(bad);
      const ctx = makeCtx(entry.manifest, {
        dataDir, settingsOf, keysReader, fetchImpl, debug,
        onCapability: (pid, def) => { if (!attempt.dead) capabilities.set(def.id, { ...def, plugin: pid }); },
      });
      if (typeof instance.start === "function") await instance.start(ctx);
      if (attempt.dead) {
        try { await instance.stop?.(); } catch { /* it was abandoned already */ }
        throw new Error("start-abandoned");
      }
      return instance;
    }, { timeoutMs: lim.startMs });
    markers.clearBooting();

    if (r.ok && store.get(id)?.enabled) {
      running.set(id, { state: "on", instance: r.value });
      store.update(id, { failStreak: 0 });
      return;
    }
    attempt.dead = true;
    dropCapabilities(id);
    if (r.ok) {
      // Switched off while it was starting (a rejection it left, say): it does not come up.
      running.delete(id);
      try { await r.value.stop?.(); } catch { /* nothing to keep */ }
      return;
    }
    const message = r.timedOut ? "start-timeout" : firstLine(r.error);
    const row = store.get(id);
    const streak = row.failStreak + 1;
    store.update(id, { failStreak: streak, lastError: message, lastErrorAt: now() });
    running.set(id, { state: "failed", instance: null });
    log("warn", `${id}: start failed (${streak}/${lim.startFailLimit}): ${message}`);
    if (streak >= lim.startFailLimit) {
      running.delete(id);
      disable(id, "start-failed", message);
    }
  }

  async function applyScan(found) {
    entries.clear();
    for (const e of found) entries.set(e.id, e);
    for (const e of found) {
      if (e.status !== "ok") continue;
      const row = store.ensure(e.id);
      const keys = [...new Set([...row.variantKeys, ...e.manifest.variantKeys])];
      store.update(e.id, { versionSeen: e.manifest.version, ...(keys.length !== row.variantKeys.length ? { variantKeys: keys } : {}) });
      missing.delete(e.id);
    }
    // A running plugin whose folder went or no longer reads is stopped; its row stays for when it comes back.
    for (const id of [...running.keys()]) {
      if (entries.get(id)?.status !== "ok") {
        await stopInstance(id);
        if (!entries.has(id)) missing.add(id);
      }
    }
    for (const row of store.all()) {
      if (row.disabledReason === "trashed") continue;
      if (!entries.has(row.id)) missing.add(row.id);
    }
  }

  async function init() {
    return locked(async () => {
      const leftovers = markers.takeLeftovers();
      await applyScan(await scanPluginDir(root));
      for (const { id, why, message } of leftovers) {
        if (!store.get(id)) continue;
        disable(id, why, message ?? "");
      }
      if (safeMode) return;
      for (const e of entries.values()) {
        if (e.status === "ok" && store.get(e.id).enabled) await start(e.id);
      }
    });
  }

  function stateOf(id) {
    const entry = entries.get(id);
    const row = store.get(id);
    if (entry?.status === "broken") return "broken";
    if (entry?.status === "incompatible") return "incompatible";
    if (missing.has(id) || !entry) return "missing";
    if (["crash", "crash-during-start", "unhandled-rejection"].includes(row?.disabledReason)) return "crash-disabled";
    if (row?.disabledReason === "start-failed" && !row.enabled) return "auto-disabled";
    const rt = running.get(id);
    if (rt?.state === "starting") return "starting";
    if (rt?.state === "failed") return "failed";
    if (rt?.state === "on") return row.cooldownUntil && now() < row.cooldownUntil ? "cooling" : "on";
    return "off";
  }

  function view(id) {
    const entry = entries.get(id);
    const row = store.get(id) ?? {};
    const state = stateOf(id);
    return {
      id,
      name: entry?.manifest?.name ?? { en: id },
      description: entry?.manifest?.description ?? null,
      version: entry?.manifest?.version ?? row.versionSeen ?? null,
      provides: entry?.manifest?.provides ?? [],
      needsKeys: entry?.manifest?.needsKeys === true,
      hosts: entry?.manifest?.hosts ?? [],
      state,
      enabled: row.enabled === true,
      safeMode,
      problems: entry?.problems ?? [],
      needs: entry?.needs ?? null,
      lastError: row.lastError ?? null,
      lastErrorAt: row.lastErrorAt ?? null,
      failStreak: row.failStreak ?? 0,
      hookStreak: row.hookStreak ?? 0,
      disabledReason: row.disabledReason ?? null,
      disabledAt: row.disabledAt ?? null,
      retryAt: state === "cooling" ? row.cooldownUntil : null,
      variantKeys: row.variantKeys ?? [],
    };
  }

  const list = () => {
    const ids = new Set([...entries.keys(), ...store.all().filter((r) => r.disabledReason !== "trashed").map((r) => r.id)]);
    return [...ids].sort().map(view);
  };

  async function setEnabled(id, on, { confirmKeys = false } = {}) {
    return locked(async () => {
      const entry = entries.get(id);
      if (!entry) throw new PluginError("not-found", 404);
      if (!on) {
        store.update(id, { enabled: false, disabledReason: null, disabledAt: null });
        await stopInstance(id);
        return view(id);
      }
      if (safeMode) throw new PluginError("safe-mode");
      if (entry.status !== "ok") throw new PluginError(entry.status === "incompatible" ? "incompatible" : "broken");
      if (entry.manifest.needsKeys && confirmKeys !== true) throw new PluginError("keys-confirm-required", 400);
      store.update(id, { enabled: true, failStreak: 0, hookStreak: 0, cooldownStep: 0, cooldownUntil: null, disabledReason: null, disabledAt: null });
      await stopInstance(id);
      await start(id);
      return view(id);
    });
  }

  // ── hooks ──
  function recordHookFailure(id, error, timedOut) {
    const row = store.get(id);
    const message = timedOut ? "hook-timeout" : firstLine(error);
    // Calls that were already running when the pause began fail inside it: they do not deepen it.
    if (row.cooldownUntil && now() < row.cooldownUntil) {
      store.update(id, { lastError: message, lastErrorAt: now() });
      return message;
    }
    const streak = row.hookStreak + 1;
    const threshold = row.cooldownStep > 0 ? 1 : lim.hookFailLimit;
    if (streak < threshold) {
      store.update(id, { hookStreak: streak, lastError: message, lastErrorAt: now() });
      return message;
    }
    const minutes = lim.cooldownMinutes[Math.min(row.cooldownStep, lim.cooldownMinutes.length - 1)];
    store.update(id, {
      hookStreak: 0, cooldownStep: row.cooldownStep + 1, cooldownUntil: now() + minutes * MINUTE_MS,
      lastError: message, lastErrorAt: now(),
    });
    log("warn", `${id}: cooling for ${minutes} min after ${streak} failures: ${message}`);
    notify({ id, event: "cooling", reason: "hook-failures", message, minutes });
    return message;
  }

  function noteFailure(id, error, timedOut) {
    const message = timedOut ? "hook-timeout" : firstLine(error);
    store.update(id, { lastError: message, lastErrorAt: now() });
    return message;
  }

  /** The facts about the asking console a plugin asked for, and nothing else. */
  function consoleFor(id, facts) {
    const wants = entries.get(id)?.manifest?.console ?? [];
    return Object.fromEntries(wants.filter((k) => facts?.[k] !== undefined).map((k) => [k, facts[k]]));
  }

  /**
   * call: { lang?, clientVersion?, console? } the caller knows (the Accept-Language and Version headers, and what
   * the console told it). The hook gets (args, { signal, lang, clientVersion, console }) with console cut
   * down to the manifest's `console` list; language and version are never part of it.
   */
  async function callHook(id, kind, args, call = {}) {
    const rt = running.get(id);
    if (rt?.state !== "on") return { skipped: "not-running" };
    const fn = rt.instance?.[kind];
    if (typeof fn !== "function") return { skipped: "no-hook" };
    const row = store.get(id);
    if (row?.cooldownUntil && now() < row.cooldownUntil) return { skipped: "cooling", retryAt: row.cooldownUntil };

    // A plugin that said needsKeys gets the parsed keys for this one call; they are never kept in ctx.
    const given = KEYED_HOOKS.has(kind) && entries.get(id)?.manifest?.needsKeys ? { ...args, keys: readOnlyKeys(keysProvider?.()) } : args;
    const r = await runInPlugin(id, (signal) => fn.call(rt.instance, given, { signal, lang: call.lang ?? "en", clientVersion: call.clientVersion ?? null, console: consoleFor(id, call.console) }), { timeoutMs: lim.hookMs[kind] ?? lim.hookMsDefault });
    if (r.ok) {
      if (row.hookStreak || row.cooldownStep || row.cooldownUntil) store.update(id, { hookStreak: 0, cooldownStep: 0, cooldownUntil: null });
      return { value: r.value };
    }
    // The listing hook runs for up to 200 files at a time and on a cold disk; its failures are shown but never
    // start the pause that would refuse a download in progress.
    const message = LISTING_HOOKS.has(kind)
      ? noteFailure(id, r.error, r.timedOut)
      : recordHookFailure(id, r.error, r.timedOut);
    // A hook that fails because its files are gone is a plugin that went missing, not a failing one.
    if (r.error?.code === "ENOENT" && entries.has(id)) {
      const gone = await fsp.access(entries.get(id).dir).then(() => false, () => true);
      if (gone) await locked(async () => { await applyScan(await scanPluginDir(root)); });
    }
    return { error: { message, timedOut: r.timedOut === true } };
  }

  // ── process-level errors the guard attributes to a plugin ──
  // Behind the same lock as start and stop: a rejection that arrives while the plugin is starting is
  // handled once the start has settled, so the start cannot switch it back on afterwards.
  const pluginRejected = (id, err) => locked(async () => {
    const message = firstLine(err);
    log("error", `${id}: unhandled rejection: ${message}`);
    if (!store.get(id)) return;
    store.update(id, { enabled: false, disabledReason: "unhandled-rejection", disabledAt: now(), lastError: message, lastErrorAt: now() });
    notify({ id, event: "crash-disabled", reason: "unhandled-rejection", message });
    await stopInstance(id);
  });
  const writeCrash = (id, err) => markers.writeCrash(id, firstLine(err));

  // ── folders coming and going ──
  const rescan = () => locked(async () => {
    const before = new Set(missing);
    await applyScan(await scanPluginDir(root));
    if (safeMode) return;
    // Back after being gone: an enabled plugin starts again with its settings and state kept.
    for (const id of before) {
      const e = entries.get(id);
      if (e?.status === "ok" && !missing.has(id) && store.get(id).enabled && !running.has(id)) await start(id);
    }
  });

  function startWatching() {
    if (watcher) return () => {};
    watcher = setInterval(() => { rescan().catch((err) => log("error", `rescan failed: ${err.message}`)); }, lim.rescanMs);
    watcher.unref?.();
    return () => { clearInterval(watcher); watcher = null; };
  }

  // ── the plugins' own trash ──
  // Not the shared trash: a restore from there could put code into plugins/. Only entries this registry
  // wrote (a sibling .json with by === TRASH_META_BY) come back, and only into plugins/<id>.
  async function trash(id, { dropCache = false, dropSettings = false } = {}) {
    return locked(async () => {
      const entry = entries.get(id);
      if (!entry) throw new PluginError("not-found", 404);
      await stopInstance(id);
      store.update(id, { enabled: false });
      await fsp.mkdir(trashRoot, { recursive: true });
      const name = `${id}.${now()}`;
      const dest = path.join(trashRoot, name);
      await moveDir(entry.dir, dest);
      await fsp.writeFile(`${dest}.json`, JSON.stringify({ by: TRASH_META_BY, id, version: entry.manifest?.version ?? null, trashedAt: now() }));
      if (dropCache) await fsp.rm(path.join(dataDir, "plugin-cache", id), { recursive: true, force: true });
      if (dropSettings) {
        clearSettings?.(id);
        store.remove(id);
      } else {
        // A trashed plugin's keys are forgotten: nothing is left behind to answer for them.
        store.update(id, { disabledReason: "trashed", variantKeys: [] });
      }
      await applyScan(await scanPluginDir(root));
      missing.delete(id);
      return { name };
    });
  }

  async function listTrashed() {
    let names;
    try { names = await fsp.readdir(trashRoot); } catch { return []; }
    const out = [];
    for (const name of names.sort()) {
      const m = TRASH_NAME_RE.exec(name);
      if (!m) continue;
      try {
        const meta = JSON.parse(await fsp.readFile(path.join(trashRoot, `${name}.json`), "utf8"));
        const st = await fsp.lstat(path.join(trashRoot, name));
        if (meta?.by !== TRASH_META_BY || meta.id !== m[1] || !st.isDirectory() || st.isSymbolicLink()) continue;
        out.push({ name, id: m[1], version: meta.version ?? null, trashedAt: meta.trashedAt ?? Number(m[2]) });
      } catch { /* no registry note: not ours, not listed */ }
    }
    return out;
  }

  async function restore(name) {
    return locked(async () => {
      const item = (await listTrashed()).find((t) => t.name === name);
      if (!item) throw new PluginError("not-found", 404);
      const target = path.join(root, item.id);
      if (await fsp.lstat(target).then(() => true, () => false)) throw new PluginError("exists");
      await fsp.mkdir(root, { recursive: true });
      await moveDir(path.join(trashRoot, name), target);
      await fsp.rm(path.join(trashRoot, `${name}.json`), { force: true });
      if (store.get(item.id)) store.update(item.id, { enabled: false, disabledReason: null, disabledAt: null });
      await applyScan(await scanPluginDir(root));
      return view(item.id);
    });
  }

  // ── variant keys: remembered, so a query naming one is refused when its plugin is not on ──
  function recordVariantKeys(id, keys) {
    const row = store.get(id);
    if (!row) return;
    const merged = [...new Set([...row.variantKeys, ...keys])];
    if (merged.length !== row.variantKeys.length) store.update(id, { variantKeys: merged });
  }

  /** null when no plugin ever claimed the key; otherwise who did and whether it can serve it now. */
  function variantKeyStatus(key) {
    const row = store.all().find((r) => r.variantKeys.includes(key));
    return row ? { id: row.id, available: stateOf(row.id) === "on" } : null;
  }

  /** Every key any variant plugin ever claimed, on or off: a client uses them to tell two URLs of one file apart. */
  const variantKeys = () => [...new Set(store.all().flatMap((r) => r.variantKeys))].sort();

  /** The variant keys one plugin claims (from its manifest and from what it was seen to claim). */
  const keysOf = (id) => store.get(id)?.variantKeys ?? [];

  /** The `console` items a plugin's manifest asks for ([] when it asks for none or is unknown). */
  const consoleWanted = (id) => entries.get(id)?.manifest?.console ?? [];

  /** Changes whenever the server's prod.keys is read afresh, so what was worked out from the old keys is not reused. */
  let stampKeys = null;
  let stampN = 0;
  function keysStamp() {
    const k = keysProvider?.() ?? null;
    if (k !== stampKeys) { stampKeys = k; stampN++; }
    return stampN;
  }

  /** The ids of plugins that are on and provide `kind` ("variant", ...), in id order. */
  const activeProviding = (kind) => [...entries.values()]
    .filter((e) => e.status === "ok" && e.manifest.provides.includes(kind) && stateOf(e.id) === "on")
    .map((e) => e.id).sort();

  /** What the plugins that are on ask of a console: the union of their manifests' `console` lists. */
  const wantedConsole = () => [...new Set(activeProviding("variant").flatMap((id) => entries.get(id).manifest.console))].sort();

  async function stopAll() {
    if (watcher) { clearInterval(watcher); watcher = null; }
    await locked(async () => { for (const id of [...running.keys()]) await stopInstance(id); });
  }

  return {
    API_VERSION, init, list, view, setEnabled, callHook, rescan, startWatching, trash, listTrashed, restore,
    recordVariantKeys, variantKeyStatus, variantKeys, keysOf, consoleWanted, keysStamp, activeProviding, wantedConsole, consoleFor, stopAll, pluginRejected, writeCrash,
    clearBooting: markers.clearBooting,
    capabilities: () => [...capabilities.values()],
    safeMode,
    versionOf: (id) => entries.get(id)?.manifest?.version ?? null,
    paths: { root, trashRoot },
    /** For tests: the plugin's instance when it is running. */
    _instance: (id) => running.get(id)?.instance ?? null,
  };
}
