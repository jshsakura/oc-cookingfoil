/**
 * Server behaviour from the admin page's settings tab:
 *
 *   GET  /admin/api/server-settings                   { settings: { <name>: { value, source: "saved"|"env", envValue } }, titledb,
 *                                                       directDownload: { configured, up, since, checkedAt } }
 *   POST /admin/api/server-settings                   { <name>: value | null }  save (null = back to compose); applies at once
 *                                                     400 { error, field } when titledbSource or publicDirectBaseUrl points at a private network
 *                                                     403 { error, field } from an automation token naming a TOKEN_LOCKED setting
 *   POST /admin/api/server-settings/titledb-refresh   fetch titledb now, in the background
 *
 * The names are security/server-settings.js SETTINGS.
 */
import * as serverSettings from "../../security/server-settings.js";
import * as shopCache from "../../meta/shop-cache.js";
import nszQueue from "../../meta/nsz-service.js";
import * as titledbStore from "../../meta/titledb-store.js";
import { refresh as refreshTitledb } from "../../meta/titledb-bootstrap.js";
import debug from "../../debug.js";
import * as directHealth from "../../security/direct-health.js";
import { checkOutboundUrl, OutboundError } from "../../security/outbound-guard.js";

// Settings baked into the list the server hands out: rebuild it after a change.
const REBUILD = new Set(["publicBaseUrl", "welcomeMessage", "eshopPrices", "publicDirectBaseUrl", "directDownloads", "downloadLinkTtl"]);
// Addresses the server fetches itself: refused when they point at a private network.
const OUTBOUND = ["titledbSource", "publicDirectBaseUrl"];
// Settings that change the names themselves: reload titledb and read every file again.
const RESCAN = new Set(["langPriority", "extractIcons"]);
// Who may sign in and how, and the addresses consoles are sent to: never changed with an automation token.
export const TOKEN_LOCKED = ["devicePairing", "consolePasswords", "deviceApproval", "publicBaseUrl", "publicDirectBaseUrl", "directDownloads", "downloadLinkTtl"];

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
  const view = () => ({ settings: serverSettings.describe(), titledb: { ...titledbStore.status(), fetching: Boolean(fetching) }, directDownload: directHealth.status() });

  router.get("/api/server-settings", handle((req, res) => res.json(view())));

  router.post("/api/server-settings", handle(async (req, res) => {
    const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
    const locked = req.apiToken ? TOKEN_LOCKED.filter((k) => k in body) : [];
    if (locked.length) return res.status(403).json({ error: "automation tokens cannot change sign-in or address settings", field: locked[0] });
    for (const field of OUTBOUND) {
      const value = typeof body[field] === "string" ? body[field].trim().replace(/\/+$/, "") : "";
      // Only a new address: saving another setting must not hinge on this one's DNS.
      // A malformed value is left to save(), which names the field as usual.
      if (!/^https?:\/\/\S+$/.test(value) || value === serverSettings.describe()[field]?.value) continue;
      try {
        await checkOutboundUrl(value);
      } catch (err) {
        if (!(err instanceof OutboundError)) throw err;
        return res.status(400).json({ error: err.message, field });
      }
    }
    let changed;
    try {
      changed = serverSettings.save(body);
    } catch (err) {
      return res.status(400).json({ error: `${err.message} 값이 맞지 않습니다`, field: err.message });
    }
    // A new direct address is checked at once, so the page shows whether it answers.
    if (changed.includes("publicDirectBaseUrl")) await directHealth.checkSoon();
    if (changed.some((k) => RESCAN.has(k))) {
      if (changed.includes("langPriority")) await titledbStore.load();
      shopCache.invalidate({ rescan: true });
    } else if (changed.some((k) => REBUILD.has(k))) {
      shopCache.invalidate();
    }
    // The conversion queue stops when turned off and looks again after any of its settings.
    if (changed.some((k) => k.startsWith("nsz"))) await nszQueue.settingsChanged();
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
