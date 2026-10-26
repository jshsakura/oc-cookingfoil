/**
 * The plugins page's routes. Only a person on the admin page switches, deletes or restores a plugin
 * (admin-page.js TOKEN_BLOCKED_RE refuses automation tokens the writes): switching one on runs code
 * from data/plugins in this process, so no tool may do it. The list is open to tokens.
 *
 *   GET  /admin/api/plugins                  { safeMode, plugins: [registry view], trashed: [{ name, id, version, trashedAt }] }
 *   POST /admin/api/plugins/rescan           same answer, after looking at the folder again
 *   POST /admin/api/plugins/restore          { name }  a plugin the registry deleted comes back, switched off
 *   POST /admin/api/plugins/:id/enabled      { on, confirmKeys? }   needsKeys plugins want confirmKeys: true to switch on
 *   POST /admin/api/plugins/:id/cache/clear  empties the plugin's cache folder (each plugin's cache is capped; see plugins/cache.js)
 *   POST /admin/api/plugins/:id/trash        { dropData? }  moves the folder to the plugins' own trash;
 *                                            dropData also deletes its cache and stored settings
 * Errors answer { error } in the page's language with the registry's status (404, 409, 400).
 */
import debug from "../../debug.js";
import { PluginError } from "../../plugins/registry.js";
import { pluginCache, pluginRegistry } from "../../plugins/instance.js";
import { requestLang } from "../../meta/langs.js";
import { TOP_WORDS } from "./top-i18n.js";

const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,39}\.\d{10,16}$/;
const ERROR_WORD = {
  "not-found": "pl.e.notFound", "safe-mode": "pl.e.safeMode", broken: "pl.e.broken", incompatible: "pl.e.incompat",
  "keys-confirm-required": "pl.e.keys", exists: "pl.e.exists",
};
const word = (lang, key) => TOP_WORDS[lang]?.[key] ?? TOP_WORDS.en[key];

async function snapshot(registry, cache) {
  const used = await cache.usage();
  const plugins = registry.list().map((p) => ({ ...p, cache: used[p.id] ?? { bytes: 0, files: 0, capBytes: cache.capBytes } }));
  return { safeMode: registry.safeMode, plugins, trashed: await registry.listTrashed() };
}

export function mountPluginsApi(router, requireSession, registry = pluginRegistry(), cache = pluginCache()) {
  const handle = (fn) => async (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store");
    try {
      await fn(req, res);
    } catch (err) {
      const lang = requestLang(req);
      if (err instanceof PluginError) return res.status(err.status).json({ error: word(lang, ERROR_WORD[err.code] ?? "pl.e.failed"), code: err.code });
      debug.error("admin: plugins: %s", err.message);
      res.status(500).json({ error: word(lang, "pl.e.failed") });
    }
  };
  const bad = (res, req, key = "pl.e.failed") => res.status(400).json({ error: word(requestLang(req), key) });

  router.get("/api/plugins", handle(async (req, res) => res.json(await snapshot(registry, cache))));

  router.post("/api/plugins/rescan", handle(async (req, res) => {
    await registry.rescan();
    res.json({ ok: true, ...(await snapshot(registry, cache)) });
  }));

  router.post("/api/plugins/restore", handle(async (req, res) => {
    const name = req.body?.name;
    if (typeof name !== "string" || !NAME_RE.test(name)) return bad(res, req);
    res.json({ ok: true, plugin: await registry.restore(name), ...(await snapshot(registry, cache)) });
  }));

  router.post("/api/plugins/:id/enabled", handle(async (req, res) => {
    const { id } = req.params;
    if (!ID_RE.test(id) || typeof req.body?.on !== "boolean") return bad(res, req);
    const plugin = await registry.setEnabled(id, req.body.on, { confirmKeys: req.body.confirmKeys === true });
    res.json({ ok: true, plugin });
  }));

  router.post("/api/plugins/:id/cache/clear", handle(async (req, res) => {
    const { id } = req.params;
    if (!ID_RE.test(id)) return bad(res, req);
    await cache.clear(id);
    res.json({ ok: true, ...(await snapshot(registry, cache)) });
  }));

  router.post("/api/plugins/:id/trash", handle(async (req, res) => {
    const { id } = req.params;
    if (!ID_RE.test(id)) return bad(res, req);
    const dropData = req.body?.dropData === true;
    res.json({ ok: true, ...(await registry.trash(id, { dropCache: dropData, dropSettings: dropData })) });
  }));
}
