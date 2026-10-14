/**
 * Server behaviour from the admin page's settings tab:
 *
 *   GET  /admin/api/server-settings                   { settings: { <name>: { value, source: "saved"|"env", envValue } }, titledb }
 *   POST /admin/api/server-settings                   { <name>: value | null }  save (null = back to compose); applies at once
 *   POST /admin/api/server-settings/titledb-refresh   fetch titledb now, in the background
 *
 * The names are security/server-settings.js SETTINGS.
 */
import * as serverSettings from "../../security/server-settings.js";
import * as shopCache from "../../meta/shop-cache.js";
import * as titledbStore from "../../meta/titledb-store.js";
import { refresh as refreshTitledb } from "../../meta/titledb-bootstrap.js";
import debug from "../../debug.js";

// Settings baked into the list the server hands out: rebuild it after a change.
const REBUILD = new Set(["publicBaseUrl", "welcomeMessage", "eshopPrices", "directBaseUrl", "downloadLinkTtl"]);
// Settings that change the names themselves: reload titledb and read every file again.
const RESCAN = new Set(["langPriority", "extractIcons"]);

let fetching = null;

export function mountServerSettingsApi(router, requireSession) {
  const handle = (fn) => async (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store");
    try {
      await fn(req, res);
    } catch (err) {
      debug.error("admin: server settings: %s", err.message);
      res.status(500).json({ error: "처리하지 못했습니다. 서버 기록을 봅니다" });
    }
  };
  const view = () => ({ settings: serverSettings.describe(), titledb: { ...titledbStore.status(), fetching: Boolean(fetching) } });

  router.get("/api/server-settings", handle((req, res) => res.json(view())));

  router.post("/api/server-settings", handle(async (req, res) => {
    const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
    let changed;
    try {
      changed = serverSettings.save(body);
    } catch (err) {
      return res.status(400).json({ error: `${err.message} 값이 맞지 않습니다`, field: err.message });
    }
    if (changed.some((k) => RESCAN.has(k))) {
      if (changed.includes("langPriority")) await titledbStore.load();
      shopCache.invalidate({ rescan: true });
    } else if (changed.some((k) => REBUILD.has(k))) {
      shopCache.invalidate();
    }
    if (changed.length) debug.log("admin: server settings changed: %s", changed.join(", "));
    res.json({ ok: true, changed, ...view() });
  }));

  router.post("/api/server-settings/titledb-refresh", handle((req, res) => {
    if (!fetching) {
      fetching = refreshTitledb()
        .then((results) => debug.log("admin: titledb fetched (%d regions ok)", results.filter((r) => r.ok).length))
        .catch((err) => debug.error("admin: titledb fetch failed: %s", err.message))
        .finally(() => { fetching = null; });
    }
    res.status(202).json({ ok: true, message: "게임 정보를 받기 시작했습니다. 몇 분 걸릴 수 있습니다." });
  }));
}
