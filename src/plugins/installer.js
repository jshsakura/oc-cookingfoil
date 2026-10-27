/**
 * Installing a plugin from a zip on the admin page, in two steps so the admin sees what is coming first.
 *
 *   installer.stage(zipBuffer, from?)     unpack and check into data/plugins-incoming/<stagedId>; nothing is installed.
 *                                         `from` ({ id, repo, tag }) marks a zip fetched from the recommended list
 *                                         (recommended.js): the install switch does not gate it, but its id must match
 *                                         -> { stagedId, manifest, existing, sha256, expiresAt }
 *   installer.confirm(stagedId, { overwrite })   move it into data/plugins/<id>, switched off -> registry view
 *   installer.sweep()                     clear what a stopped server left in plugins-incoming (called at start)
 *
 * Uploads are off unless the server's .env says COOK_PLUGIN_INSTALL=1 (allowed()). One upload waits at a time and is
 * dropped after STAGE_TTL_MS. An installed plugin always arrives switched off; turning it on is a separate
 * step with its own password check (routes/admin/plugins-api.js).
 */
import crypto from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import { PluginError } from "./registry.js";
import { readStagedManifest, unpackPlugin, UnpackError, UNPACK_LIMITS } from "./unpack.js";

export const STAGE_TTL_MS = 10 * 60_000;
export const installAllowed = () => process.env.COOK_PLUGIN_INSTALL === "1";

export function createInstaller({ registry, dataDir, now = Date.now, allowed = installAllowed, notify = () => {}, limits = UNPACK_LIMITS }) {
  const incoming = path.join(dataDir, "plugins-incoming");
  let staged = null; // { stagedId, dir, manifest, sha256, expiresAt, timer }
  let confirming = false;
  let queue = Promise.resolve();

  /** Uploads are handled one at a time: two at once would race over the one waiting place. */
  const serial = (fn) => {
    const next = queue.then(fn, fn);
    queue = next.catch(() => {});
    return next;
  };

  const forget = (item) => { if (item) clearTimeout(item.timer); };
  const dropStaged = async () => {
    // What is being installed right now is not thrown away from under the install.
    if (confirming) return;
    const gone = staged;
    staged = null;
    forget(gone);
    if (gone) await fsp.rm(gone.dir, { recursive: true, force: true });
  };

  async function sweep() {
    forget(staged);
    staged = null;
    await fsp.rm(incoming, { recursive: true, force: true });
  }

  function guard() {
    if (!allowed()) throw new PluginError("install-off", 403);
  }

  const stage = (zip, from = null) => serial(async () => {
    if (!from) guard();
    if (confirming) throw new PluginError("busy");
    await dropStaged();
    const stagedId = crypto.randomBytes(12).toString("hex");
    const dir = path.join(incoming, stagedId);
    await fsp.mkdir(incoming, { recursive: true, mode: 0o700 });
    let unpacked;
    try {
      unpacked = await unpackPlugin(zip, dir, limits);
    } catch (err) {
      if (err instanceof UnpackError) throw new PluginError("bad-package", 400, { reason: err.code });
      throw err;
    }
    if (from && unpacked.manifest.id !== from.id) {
      await fsp.rm(dir, { recursive: true, force: true });
      throw new PluginError("bad-package", 400, { reason: "id" });
    }
    const sha256 = crypto.createHash("sha256").update(zip).digest("hex").slice(0, 16);
    const expiresAt = now() + STAGE_TTL_MS;
    const item = { stagedId, dir, manifest: unpacked.manifest, sha256, expiresAt, timer: null, from };
    item.timer = setTimeout(() => { if (staged === item) dropStaged().catch(() => {}); }, STAGE_TTL_MS);
    item.timer.unref?.();
    staged = item;
    const current = registry.list().find((p) => p.id === unpacked.manifest.id);
    return {
      stagedId,
      manifest: unpacked.manifest,
      existing: current ? { version: current.version, state: current.state } : null,
      sha256,
      expiresAt,
    };
  });

  async function confirm(stagedId, { overwrite = false } = {}) {
    if (!(staged?.stagedId === stagedId && staged.from)) guard();
    if (confirming) throw new PluginError("busy");
    // A stale or foreign id never discards the upload that is really waiting; only an expired one goes.
    if (staged && now() > staged.expiresAt) await dropStaged();
    const item = staged;
    if (!item || item.stagedId !== stagedId) throw new PluginError("stage-gone", 404);
    const current = registry.list().find((p) => p.id === item.manifest.id);
    if (current && !overwrite) throw new PluginError("exists", 409, { existing: { version: current.version, state: current.state }, sha256: item.sha256 });
    // From here until it is installed this upload is spoken for: no new upload and no timer takes it away,
    // and a second press of the button finds it busy rather than installing it twice.
    confirming = true;
    forget(item);
    try {
      // What is on disk is what gets installed, so it is read and checked again, not trusted from the first look.
      let manifest;
      try { ({ manifest } = await readStagedManifest(item.dir)); } catch { throw new PluginError("stage-gone", 404); }
      const source = item.from ? { source: "recommended", repo: item.from.repo, tag: item.from.tag } : { source: "upload" };
      const plugin = await registry.installFrom(item.dir, manifest.id, { overwrite, origin: { ...source, sha256: item.sha256, version: manifest.version, at: now() } });
      staged = null;
      notify({ id: manifest.id, event: "installed", reason: source.source, message: manifest.version });
      return plugin;
    } catch (err) {
      // The folder may be gone (moved or never there): then there is nothing left to confirm.
      if (!await fsp.lstat(item.dir).then(() => true, () => false)) staged = null;
      throw err;
    } finally {
      confirming = false;
    }
  }

  return { stage, confirm, sweep, discard: dropStaged, allowed };
}
