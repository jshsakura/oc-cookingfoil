/**
 * Fake plugins for the registry tests: a folder with a manifest and an index.js whose body the test
 * chooses. Every one is written into a temp data dir; nothing here touches a real plugins folder.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, SECURITY_MIGRATIONS } from "../../src/db/database.js";
import { createRegistry } from "../../src/plugins/registry.js";

export const manifestOf = (id, extra = {}) => ({
  id, apiVersion: 1, version: "1.0.0", name: { en: id }, provides: ["metadata"], ...extra,
});

/** index.js bodies. Each default-exports an object with metadata() so the `metadata` contract holds. */
export const BODIES = {
  ok: "export default { async start() {}, async stop() {}, async metadata(a) { return { names: { en: 'ok-' + a.id } }; } };",
  throwsOnImport: "throw new Error('boom at import');",
  throwsOnStart: "export default { async start() { throw new Error('boom at start'); }, async metadata() {} };",
  hangsOnStart: "export default { start() { return new Promise(() => {}); }, async metadata() {} };",
  throwsInHook: "export default { async metadata() { throw new Error('boom in hook'); } };",
  hangsInHook: "export default { metadata() { return new Promise(() => {}); } };",
  floatingRejection: "export default { async metadata() { Promise.reject(new Error('floating')); return {}; } };",
  noMetadataHook: "export default { async start() {} };",
  enoentInHook: "export default { async metadata() { const e = new Error('gone'); e.code = 'ENOENT'; throw e; } };",
};

export function makeDataDir() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cf-plugins-"));
  fs.mkdirSync(path.join(dataDir, "plugins"), { recursive: true });
  return dataDir;
}

export function writePlugin(dataDir, id, { body = BODIES.ok, manifest = manifestOf(id), rawManifest = null } = {}) {
  const dir = path.join(dataDir, "plugins", id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "plugin.json"), rawManifest ?? JSON.stringify(manifest));
  if (body !== null) fs.writeFileSync(path.join(dir, "index.js"), body);
  return dir;
}

/** A registry on a fresh in-memory security db; `clock.t` moves time. */
export function newRegistry(dataDir, opts = {}) {
  const clock = { t: opts.start ?? 1_700_000_000_000 };
  const db = opts.db ?? openDatabase(":memory:", { migrations: SECURITY_MIGRATIONS });
  const notes = [];
  const registry = createRegistry({
    db, dataDir, now: () => clock.t, notify: (n) => notes.push(n),
    limits: { startMs: 60, stopMs: 60, hookMs: { metadata: 60, plan: 60, variants: 60 }, hookMsDefault: 60, ...(opts.limits ?? {}) },
    safeMode: opts.safeMode ?? false,
    keysProvider: opts.keysProvider,
  });
  return { registry, db, clock, notes };
}
