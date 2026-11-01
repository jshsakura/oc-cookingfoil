/**
 * The RetroArch config files in the base pack that the admin page edits, with a history of every change:
 *
 *   retroarch.cfg                 the console's main config, written to the card only when it has none
 *   config/<Core>/<Core>.cfg      the core's override: RetroArch reads it over retroarch.cfg every time the
 *                                 core starts, so it reaches consoles that already have RetroArch
 *   config/<Core>/<Core>.opt      the core's options
 *   config/<Core>/<game>.cfg|opt  one game's, sent with that game
 *
 *   list()                    { global, cores: [{ core, files: [{ rel, kind, game, values }] }] }
 *   read(rel)                 { rel, exists, values }           secrets left out (ra-config.js)
 *   write(rel, changes, by)   { rel, values, change }           change: the history entry, or null when nothing changed
 *   history({ rel, limit })   [{ id, rel, at, by, changes: [{ key, from, to }], restoreOf? }]   newest first
 *   restore(id, by)           puts the file back as it was before that change, or every file of a batch
 *                             (write's `batch`), each restore itself a new change: { restored, batch }
 *
 * A file left with no lines is removed, and an emptied core folder with it. History lines keep the
 * whole text before and after, so a restore brings back comments and keys this page never shows.
 */
import fsp from "fs/promises";
import path from "path";
import crypto from "crypto";
import { CfgError, cfgDiff, editCfg, hasContent, readCfg } from "./ra-config.js";

export const GLOBAL_REL = "retroarch.cfg";
export const HISTORY_FILE = "history.jsonl";
export const HISTORY_KEEP = 500;
export const FILE_MAX = 256 * 1024;
const PART_RE = /^[^/\\.\0][^/\\\0]{0,127}$/;

/** { core, game, kind } of an editable path, or null. Pure. */
export function cfgPath(rel) {
  if (rel === GLOBAL_REL) return { core: null, game: null, kind: "cfg" };
  const parts = String(rel ?? "").split("/");
  if (parts.length !== 3 || parts[0] !== "config" || !PART_RE.test(parts[1]) || !PART_RE.test(parts[2])) return null;
  const m = /^(.+)\.(cfg|opt)$/.exec(parts[2]);
  if (!m) return null;
  return { core: parts[1], game: m[1] === parts[1] ? null : m[1], kind: m[2] };
}

export function createRaConfig({ packDir, historyDir, now = () => Date.now() }) {
  let chain = Promise.resolve();
  const serial = (fn) => {
    const run = chain.then(fn, fn);
    chain = run.catch(() => {});
    return run;
  };
  const abs = (rel) => path.join(packDir(), ...rel.split("/"));
  const historyAbs = () => path.join(historyDir(), HISTORY_FILE);

  function checked(rel) {
    const where = cfgPath(rel);
    if (!where) throw new CfgError("badPath", { rel });
    return where;
  }

  async function text(rel) {
    const st = await fsp.stat(abs(rel)).catch(() => null);
    if (!st?.isFile()) return null;
    if (st.size > FILE_MAX) throw new CfgError("tooBig", { rel });
    return fsp.readFile(abs(rel), "utf8");
  }

  async function read(rel) {
    checked(rel);
    const t = await text(rel);
    return { rel, exists: t !== null, values: Object.fromEntries(readCfg(t ?? "")) };
  }

  async function list() {
    const dir = path.join(packDir(), "config");
    const cores = [];
    for (const d of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (!d.isDirectory() || !PART_RE.test(d.name)) continue;
      const files = [];
      for (const f of await fsp.readdir(path.join(dir, d.name), { withFileTypes: true }).catch(() => [])) {
        const rel = `config/${d.name}/${f.name}`;
        const where = f.isFile() && cfgPath(rel);
        if (!where) continue;
        const { values } = await read(rel).catch(() => ({ values: {} }));
        files.push({ rel, kind: where.kind, game: where.game, values });
      }
      files.sort((a, b) => (a.game !== null) - (b.game !== null) || String(a.game).localeCompare(String(b.game)) || a.kind.localeCompare(b.kind));
      if (files.length) cores.push({ core: d.name, files });
    }
    cores.sort((a, b) => a.core.localeCompare(b.core));
    return { global: await read(GLOBAL_REL), cores };
  }

  async function put(rel, after) {
    const file = abs(rel);
    if (!hasContent(after)) {
      await fsp.rm(file, { force: true });
      if (cfgPath(rel).core) await fsp.rmdir(path.dirname(file)).catch(() => {});
      return;
    }
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
    await fsp.writeFile(tmp, after);
    await fsp.rename(tmp, file);
  }

  async function remember(entry) {
    await fsp.mkdir(historyDir(), { recursive: true });
    const lines = (await fsp.readFile(historyAbs(), "utf8").catch(() => "")).split("\n").filter(Boolean);
    lines.push(JSON.stringify(entry));
    const kept = lines.slice(-HISTORY_KEEP);
    const tmp = `${historyAbs()}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, kept.join("\n") + "\n", { mode: 0o600 });
    await fsp.rename(tmp, historyAbs());
  }

  async function change(rel, after, by, extra = {}) {
    const before = (await text(rel)) ?? "";
    if (Buffer.byteLength(after) > FILE_MAX) throw new CfgError("tooBig", { rel });
    if (before === after) return null;
    await put(rel, after);
    const entry = { id: crypto.randomBytes(8).toString("hex"), rel, at: now(), by, before, after, ...extra };
    await remember(entry);
    return entry;
  }

  const view = (e) => ({ id: e.id, rel: e.rel, at: e.at, by: e.by ?? null, changes: cfgDiff(e.before, e.after), ...(e.restoreOf ? { restoreOf: e.restoreOf } : {}), ...(e.batch ? { batch: e.batch } : {}) });

  async function write(rel, changes, { by = null, batch = null } = {}) {
    checked(rel);
    return serial(async () => {
      const entry = await change(rel, editCfg((await text(rel)) ?? "", changes), by, batch ? { batch } : {});
      return { ...(await read(rel)), change: entry && view(entry) };
    });
  }

  async function entries() {
    return (await fsp.readFile(historyAbs(), "utf8").catch(() => "")).split("\n").filter(Boolean).flatMap((l) => {
      try {
        return [JSON.parse(l)];
      } catch {
        return [];
      }
    });
  }

  async function history({ rel = null, limit = 100 } = {}) {
    if (rel !== null) checked(rel);
    return (await entries()).filter((e) => rel === null || e.rel === rel).reverse().slice(0, limit).map(view);
  }

  /** Restores one change, or every change of a batch (newest first), each as a new change of a new batch. */
  function restore(id, { by = null } = {}) {
    return serial(async () => {
      const all = await entries();
      const one = all.find((x) => x.id === id);
      const picked = one ? [one] : all.filter((x) => x.batch === id).reverse();
      if (!picked.length) throw new CfgError("noChange", { id });
      const batch = picked.length > 1 ? crypto.randomBytes(8).toString("hex") : null;
      const done = [];
      for (const e of picked) {
        checked(e.rel);
        const entry = await change(e.rel, e.before, by, { restoreOf: e.id, ...(batch ? { batch } : {}) });
        if (entry) done.push(view(entry));
      }
      return { restored: done, batch };
    });
  }

  /** A new batch id: write() calls given it are undone together by restore(batch). */
  const newBatch = () => crypto.randomBytes(8).toString("hex");

  return { list, read, write, history, restore, newBatch };
}
