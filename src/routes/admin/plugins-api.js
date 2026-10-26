/**
 * The plugins page's routes. Only a person on the admin page switches, deletes or restores a plugin
 * (admin-page.js TOKEN_BLOCKED_RE refuses automation tokens the writes): switching one on runs code
 * from data/plugins in this process, so no tool may do it. The list is open to tokens.
 *
 *   GET  /admin/api/plugins                  { safeMode, plugins: [registry view], trashed: [{ name, id, version, trashedAt }] }
 *   POST /admin/api/plugins/rescan           same answer, after looking at the folder again
 *   POST /admin/api/plugins/restore          { name }  a plugin the registry deleted comes back, switched off
 *   POST /admin/api/plugins/install          body: the zip itself (application/zip). Only while COOK_PLUGIN_INSTALL=1.
 *                                            Unpacks and checks, installs nothing -> { stagedId, manifest, existing, sha256, expiresAt }
 *   POST /admin/api/plugins/install/confirm  { stagedId, overwrite? }  installs it, switched off; 409 exists (+ existing) without overwrite
 *   POST /admin/api/plugins/:id/enabled      { on, confirmKeys?, password? }   switching ON asks for the admin's password again;
 *                                            needsKeys plugins want confirmKeys: true
 *   POST /admin/api/plugins/:id/trash        { dropData? }  moves the folder to the plugins' own trash;
 *                                            dropData also deletes its cache and stored settings
 * Errors answer { error } in the page's language with the registry's status (404, 409, 400).
 */
import express from "express";
import debug from "../../debug.js";
import { PluginError } from "../../plugins/registry.js";
import { pluginInstaller, pluginRegistry } from "../../plugins/instance.js";
import { installAllowed } from "../../plugins/installer.js";
import { UNPACK_LIMITS } from "../../plugins/unpack.js";
import { reconfirm } from "../../security/admin-reconfirm.js";
import { requestLang } from "../../meta/langs.js";
import { TOP_WORDS } from "./top-i18n.js";

const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,39}\.\d{10,16}$/;
const ERROR_WORD = {
  "not-found": "pl.e.notFound", "safe-mode": "pl.e.safeMode", broken: "pl.e.broken", incompatible: "pl.e.incompat",
  "keys-confirm-required": "pl.e.keys", exists: "pl.e.exists", "install-off": "pl.e.installOff", "bad-package": "pl.e.package",
  "stage-gone": "pl.e.stageGone",
};
const REASON_WORD = { wrong: "pl.e.password", unavailable: "pl.e.noPassword", locked: "pl.e.locked" };
const word = (lang, key) => TOP_WORDS[lang]?.[key] ?? TOP_WORDS.en[key];

async function snapshot(registry) {
  return { safeMode: registry.safeMode, installAllowed: installAllowed(), plugins: registry.list(), trashed: await registry.listTrashed() };
}

export function mountPluginsApi(router, requireSession, registry = pluginRegistry(), installer = pluginInstaller()) {
  const handle = (fn) => async (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store");
    try {
      await fn(req, res);
    } catch (err) {
      const lang = requestLang(req);
      if (err instanceof PluginError) return res.status(err.status).json({ error: word(lang, ERROR_WORD[err.code] ?? "pl.e.failed"), code: err.code, ...err.extra });
      debug.error("admin: plugins: %s", err.message);
      res.status(500).json({ error: word(lang, "pl.e.failed") });
    }
  };
  const bad = (res, req, key = "pl.e.failed") => res.status(400).json({ error: word(requestLang(req), key) });

  router.get("/api/plugins", handle(async (req, res) => res.json(await snapshot(registry))));

  router.post("/api/plugins/rescan", handle(async (req, res) => {
    await registry.rescan();
    res.json({ ok: true, ...(await snapshot(registry)) });
  }));

  router.post("/api/plugins/restore", handle(async (req, res) => {
    const name = req.body?.name;
    if (typeof name !== "string" || !NAME_RE.test(name)) return bad(res, req);
    res.json({ ok: true, plugin: await registry.restore(name), ...(await snapshot(registry)) });
  }));

  // The zip arrives as the body. It is read only for a signed-in admin and only up to the unpacker's limit.
  router.post("/api/plugins/install", (req, res, next) => (requireSession(req, res) ? next() : undefined),
    express.raw({ type: () => true, limit: UNPACK_LIMITS.zipBytes }),
    handle(async (req, res) => {
      res.json({ ok: true, ...(await installer.stage(Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0))) });
    }));

  router.post("/api/plugins/install/confirm", handle(async (req, res) => {
    const { stagedId } = req.body ?? {};
    if (typeof stagedId !== "string" || !/^[0-9a-f]{24}$/.test(stagedId)) return bad(res, req);
    const plugin = await installer.confirm(stagedId, { overwrite: req.body.overwrite === true });
    debug.log("admin: plugin %s %s installed from an upload", plugin.id, plugin.version);
    res.json({ ok: true, plugin, ...(await snapshot(registry)) });
  }));

  router.post("/api/plugins/:id/enabled", handle(async (req, res) => {
    const { id } = req.params;
    if (!ID_RE.test(id) || typeof req.body?.on !== "boolean") return bad(res, req);
    if (req.body.on) {
      const again = await reconfirm(req, req.body.password);
      if (!again.ok) {
        debug.log("admin: switching plugin %s on was refused: %s", id, again.reason);
        return res.status(again.reason === "locked" ? 429 : 403).json({ error: word(requestLang(req), REASON_WORD[again.reason]), code: `password-${again.reason}`, ...(again.retryAfter ? { retryAfter: again.retryAfter } : {}) });
      }
    }
    const plugin = await registry.setEnabled(id, req.body.on, { confirmKeys: req.body.confirmKeys === true });
    res.json({ ok: true, plugin });
  }));

  router.post("/api/plugins/:id/trash", handle(async (req, res) => {
    const { id } = req.params;
    if (!ID_RE.test(id)) return bad(res, req);
    const dropData = req.body?.dropData === true;
    res.json({ ok: true, ...(await registry.trash(id, { dropCache: dropData, dropSettings: dropData })) });
  }));
}
