/**
 * Installing a plugin from a zip on the admin page, in two steps so the admin sees what is coming first.
 *
 *   installer.stage(zipBuffer)            unpack and check into data/plugins-incoming/<stagedId>; nothing is installed
 *                                         -> { stagedId, manifest, existing, sha256, expiresAt }
 *   installer.confirm(stagedId, { overwrite })   move it into data/plugins/<id>, switched off -> registry view
 *   installer.sweep()                     clear what a stopped server left in plugins-incoming (called at start)
 *
 * Off unless the server's .env says COOK_PLUGIN_INSTALL=1 (allowed()). One upload waits at a time and is
 * dropped after STAGE_TTL_MS. An installed plugin always arrives switched off; turning it on is a separate
 * step with its own password check (routes/admin/plugins-api.js).
 */
import crypto from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import { PluginError } from "./registry.js";
import { unpackPlugin, UnpackError, UNPACK_LIMITS } from "./unpack.js";

export const STAGE_TTL_MS = 10 * 60_000;
export const installAllowed = () => process.env.COOK_PLUGIN_INSTALL === "1";

export function createInstaller({ registry, dataDir, now = Date.now, allowed = installAllowed, notify = () => {}, limits = UNPACK_LIMITS }) {
  const incoming = path.join(dataDir, "plugins-incoming");
  let staged = null; // { stagedId, dir, manifest, sha256, expiresAt }
  let timer = null;

  const dropStaged = async () => {
    clearTimeout(timer);
    const gone = staged;
    staged = null;
    if (gone) await fsp.rm(gone.dir, { recursive: true, force: true });
  };

  async function sweep() {
    staged = null;
    await fsp.rm(incoming, { recursive: true, force: true });
  }

  function guard() {
    if (!allowed()) throw new PluginError("install-off", 403);
  }

  async function stage(zip) {
    guard();
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
    const sha256 = crypto.createHash("sha256").update(zip).digest("hex").slice(0, 16);
    const expiresAt = now() + STAGE_TTL_MS;
    staged = { stagedId, dir, manifest: unpacked.manifest, sha256, expiresAt };
    timer = setTimeout(() => { dropStaged().catch(() => {}); }, STAGE_TTL_MS);
    timer.unref?.();
    const current = registry.list().find((p) => p.id === unpacked.manifest.id);
    return {
      stagedId,
      manifest: unpacked.manifest,
      existing: current ? { version: current.version, state: current.state } : null,
      sha256,
      expiresAt,
    };
  }

  async function confirm(stagedId, { overwrite = false } = {}) {
    guard();
    // A stale or foreign id never discards the upload that is really waiting; only an expired one goes.
    if (staged && now() > staged.expiresAt) await dropStaged();
    if (!staged || staged.stagedId !== stagedId) throw new PluginError("stage-gone", 404);
    const { manifest, dir, sha256 } = staged;
    const current = registry.list().find((p) => p.id === manifest.id);
    if (current && !overwrite) throw new PluginError("exists", 409, { existing: { version: current.version, state: current.state } });
    const plugin = await registry.installFrom(dir, manifest.id, { overwrite, origin: { source: "upload", sha256, version: manifest.version, at: now() } });
    staged = null;
    clearTimeout(timer);
    notify({ id: manifest.id, event: "installed", reason: "upload", message: manifest.version });
    return plugin;
  }

  return { stage, confirm, sweep, discard: dropStaged };
}
