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
 *   POST /admin/api/plugins/recommended/install  { id, overwrite? }  fetches a recommended plugin's latest release
 *                                            (plugins/recommended.js) and installs it, switched off; not gated by the install switch
 *   POST /admin/api/plugins/install/confirm  { stagedId, overwrite? }  installs it, switched off; 409 exists (+ existing) without overwrite
 *   POST /admin/api/plugins/:id/enabled      { on, confirmKeys? }   needsKeys plugins want confirmKeys: true
 *   POST /admin/api/plugins/:id/cache/clear  empties the plugin's cache folder (each plugin's cache is capped; see plugins/cache.js)
 *   GET  /admin/api/plugins/agents           { fields, order, defaults, plugins, sources }: where each field's value is read from first
 *   POST /admin/api/plugins/agents/order     { <field>: [sources] | null }  saves the order at once; null goes back to the usual
 *   POST /admin/api/plugins/agents/clear     { id }  deletes what that plugin said about titles (it is asked again)
 *   POST /admin/api/plugins/:id/trash        { dropData? }  moves the folder to the plugins' own trash;
 *                                            dropData also deletes its cache and stored settings
 * Errors answer { error } in the page's language with the registry's status (404, 409, 400).
 */
import { rawOrChunk } from "../../meta/upload-chunks.js";
import debug from "../../debug.js";
import { PluginError } from "../../plugins/registry.js";
import { pluginCache, pluginInstaller, pluginRegistry } from "../../plugins/instance.js";
import { installAllowed } from "../../plugins/installer.js";
import { agentState, clearAgentValues, ID_RE as AGENT_ID_RE, OrderError, setAgentOrder } from "../../plugins/agent-admin.js";
import { agentParts } from "../../plugins/instance.js";
import { UNPACK_LIMITS } from "../../plugins/unpack.js";
import { RECOMMENDED, installRecommended } from "../../plugins/recommended.js";
import { githubToken } from "../../helpers/envs.js";
import { PackError, packPlugin } from "../../plugins/pack.js";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { requestLang } from "../../meta/langs.js";
import { TOP_WORDS } from "./top-i18n.js";

const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,39}\.\d{10,16}$/;
const ERROR_WORD = {
  "not-found": "pl.e.notFound", "safe-mode": "pl.e.safeMode", broken: "pl.e.broken", incompatible: "pl.e.incompat",
  "keys-confirm-required": "pl.e.keys", exists: "pl.e.exists", "install-off": "pl.e.installOff", "bad-package": "pl.e.package",
  "stage-gone": "pl.e.stageGone", busy: "pl.e.busy", "restart-needed": "pl.e.restart", "fetch-failed": "pl.e.fetch",
};
const word = (lang, key) => TOP_WORDS[lang]?.[key] ?? TOP_WORDS.en[key];

async function snapshot(registry, req, cache, events) {
  const used = await cache.usage();
  const plugins = registry.list().map((p) => ({ ...p, cache: used[p.id] ?? { bytes: 0, files: 0, capBytes: cache.capBytes }, ...(events ? { events: events.statsOf(p.id) } : {}) }));
  const recommended = RECOMMENDED.map(({ id, repo, name }) => ({ id, repo, name }));
  return { safeMode: registry.safeMode, installAllowed: installAllowed(), plugins, recommended, trashed: await registry.listTrashed() };
}

export function mountPluginsApi(router, requireSession, registry = pluginRegistry(), installer = pluginInstaller(), cache = pluginCache(), events = null) {
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

  router.get("/api/plugins", handle(async (req, res) => res.json(await snapshot(registry, req, cache, events))));

  // The folder as a zip the install upload takes back. Not gated by the install switch: it only reads.
  router.get("/api/plugins/:id/download", handle(async (req, res) => {
    const { id } = req.params;
    if (!ID_RE.test(id)) return bad(res, req);
    const plugin = registry.list().find((p) => p.id === id);
    if (!plugin || plugin.state === "missing") throw new PluginError("not-found", 404);
    let zip;
    try {
      zip = await packPlugin(path.join(registry.paths.root, id));
    } catch (err) {
      if (err instanceof PackError) throw new PluginError("bad-package", 413);
      throw err;
    }
    res.set({ "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${id}-${plugin.version ?? "0"}.zip"` });
    await pipeline(zip.outputStream, res);
  }));

  router.post("/api/plugins/rescan", handle(async (req, res) => {
    await registry.rescan();
    res.json({ ok: true, ...(await snapshot(registry, req, cache, events)) });
  }));

  router.post("/api/plugins/restore", handle(async (req, res) => {
    const name = req.body?.name;
    if (typeof name !== "string" || !NAME_RE.test(name)) return bad(res, req);
    res.json({ ok: true, plugin: await registry.restore(name), ...(await snapshot(registry, req, cache, events)) });
  }));

  // The zip arrives as the body. It is read only for a signed-in admin and only up to the unpacker's limit.
  router.post("/api/plugins/install", (req, res, next) => (requireSession(req, res) ? next() : undefined),
    // Refused before the body is read when the server does not allow installing.
    (req, res, next) => (installer.allowed() ? next() : handle(async () => { throw new PluginError("install-off", 403); })(req, res)),
    rawOrChunk({ type: () => true, limit: UNPACK_LIMITS.zipBytes }),
    handle(async (req, res) => {
      res.json({ ok: true, ...(await installer.stage(Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0))) });
    }));

  router.post("/api/plugins/recommended/install", handle(async (req, res) => {
    const { id } = req.body ?? {};
    if (typeof id !== "string" || !ID_RE.test(id)) return bad(res, req);
    const plugin = await installRecommended(id, { registry, installer, overwrite: req.body.overwrite === true, token: githubToken || null });
    debug.log("admin: plugin %s %s installed from its recommended release", plugin.id, plugin.version);
    res.json({ ok: true, plugin, ...(await snapshot(registry, req, cache, events)) });
  }));

  router.post("/api/plugins/install/confirm", handle(async (req, res) => {
    const { stagedId } = req.body ?? {};
    if (typeof stagedId !== "string" || !/^[0-9a-f]{24}$/.test(stagedId)) return bad(res, req);
    const plugin = await installer.confirm(stagedId, { overwrite: req.body.overwrite === true });
    debug.log("admin: plugin %s %s installed from an upload", plugin.id, plugin.version);
    res.json({ ok: true, plugin, ...(await snapshot(registry, req, cache, events)) });
  }));

  router.post("/api/plugins/:id/enabled", handle(async (req, res) => {
    const { id } = req.params;
    if (!ID_RE.test(id) || typeof req.body?.on !== "boolean") return bad(res, req);
    const plugin = await registry.setEnabled(id, req.body.on, { confirmKeys: req.body.confirmKeys === true });
    res.json({ ok: true, plugin });
  }));

  router.get("/api/plugins/agents", handle(async (req, res) => res.json(agentState())));

  router.post("/api/plugins/agents/order", handle(async (req, res) => {
    try {
      setAgentOrder(req.body);
    } catch (err) {
      if (err instanceof OrderError) return res.status(400).json({ error: word(requestLang(req), "pl.e.agentOrder"), code: `agent-order-${err.code}` });
      throw err;
    }
    res.json({ ok: true, ...agentState() });
  }));

  router.post("/api/plugins/agents/clear", handle(async (req, res) => {
    const id = req.body?.id;
    if (typeof id !== "string" || !AGENT_ID_RE.test(id) || !(await clearAgentValues(id))) return bad(res, req);
    res.json({ ok: true, ...agentState() });
  }));

  router.post("/api/plugins/:id/cache/clear", handle(async (req, res) => {
    const { id } = req.params;
    if (!ID_RE.test(id)) return bad(res, req);
    await cache.clear(id);
    await agentParts().store.forget(id);
    res.json({ ok: true, ...(await snapshot(registry, req, cache, events)) });
  }));

  router.post("/api/plugins/:id/trash", handle(async (req, res) => {
    const { id } = req.params;
    if (!ID_RE.test(id)) return bad(res, req);
    const dropData = req.body?.dropData === true;
    if (dropData) await agentParts().store.forget(id);
    res.json({ ok: true, ...(await registry.trash(id, { dropCache: dropData, dropSettings: dropData })) });
  }));
}
