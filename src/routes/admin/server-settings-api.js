/**
 * Server behaviour from the admin page's settings tab:
 *
 *   GET  /admin/api/server-settings                   { settings: { <name>: { value, source: "saved"|"env", envValue } }, titledb,
 *                                                       directDownload: { configured, up, since, checkedAt } }
 *   POST /admin/api/server-settings                   { <name>: value | null }  save (null = back to compose); applies at once
 *                                                     400 { error, field } when titledbSource or publicDirectBaseUrl points at a private network
 *                                                     403 { error, field } from an automation token naming a TOKEN_LOCKED setting
 *   POST /admin/api/server-settings/titledb-refresh   fetch titledb now, in the background
 *   POST /admin/api/server-settings/sync-now          read every library folder again now; { sync }
 *   POST /admin/api/server-settings/backup-now        make today's backup now; { backup }
 *
 * The GET also carries sync (meta/folder-sync.js status), backup (db/backup.js status) and
 * keys (security/prod-keys.js status; changed through admin/keys-api.js).
 *
 * The names are security/server-settings.js SETTINGS.
 */
import fs from "fs";
import * as serverSettings from "../../security/server-settings.js";
import * as shopCache from "../../meta/shop-cache.js";
import nszQueue from "../../meta/nsz-service.js";
import * as titledbStore from "../../meta/titledb-store.js";
import { refresh as refreshTitledb } from "../../meta/titledb-bootstrap.js";
import debug from "../../debug.js";
import * as directHealth from "../../security/direct-health.js";
import * as folderSync from "../../meta/folder-sync.js";
import * as backups from "../../db/backup.js";
import { checkOutboundUrl, OutboundError } from "../../security/outbound-guard.js";
import { googleReady } from "../../security/password-policy.js";
import * as envs from "../../helpers/envs.js";
import * as prodKeys from "../../security/prod-keys.js";
import * as retroCatalog from "../../retro/catalog.js";
import { apiWord } from "./api-words.js";

// Settings baked into the list the server hands out: rebuild it after a change.
const REBUILD = new Set(["publicBaseUrl", "eshopPrices", "publicDirectBaseUrl", "directDownloads", "downloadLinkTtl"]);
// Addresses the server fetches itself: refused when they point at a private network.
const OUTBOUND = ["titledbSource", "publicDirectBaseUrl", "retroPackUrl"];
// Settings that change the names themselves: reload titledb and read every file again.
const RESCAN = new Set(["langPriority", "extractIcons"]);
// Who may sign in and how, the addresses consoles are sent to, and where the client build they
// install comes from, and how long an original stays after NSZ conversion (a token setting it to 0
// would delete each original as soon as it is converted, a high disk floor would purge every kept
// one): never changed with an automation token.
export const TOKEN_LOCKED = [
  "devicePairing", "passwordLogin", "deviceApproval", "deviceLimit", "enrollPerHour", "publicBaseUrl", "publicDirectBaseUrl", "directDownloads", "downloadLinkTtl",
  "clientSource", "clientReleaseRepo", "clientReleaseTag", "clientReleaseAsset",
  "nszKeepHours", "nszKeepGb", "nszDiskFloorGb",
];

let fetching = null;

export function mountServerSettingsApi(router, requireSession) {
  const handle = (fn) => async (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store");
    try {
      await fn(req, res);
    } catch (err) {
      debug.error("admin: server settings: %s", err.message);
      res.status(500).json({ error: apiWord(req, "failed") });
    }
  };
  const view = () => ({
    settings: serverSettings.describe(),
    titledb: { ...titledbStore.status(), fetching: Boolean(fetching) },
    directDownload: directHealth.status(),
    sync: folderSync.status(),
    backup: backups.status(),
    keys: prodKeys.status(),
  });

  router.get("/api/server-settings", handle((req, res) => res.json(view())));

  // The folders are read in the background; the page asks again for the result.
  router.post("/api/server-settings/sync-now", handle((req, res) => {
    folderSync.syncNow("admin").catch(() => {});
    res.json({ sync: folderSync.status(), message: apiWord(req, "settings.rescanning") });
  }));

  router.post("/api/server-settings/backup-now", handle((req, res) => {
    try {
      const made = backups.backupNow();
      res.json({ backup: backups.status(), message: apiWord(req, "settings.backupMade", { day: made.day }) });
    } catch (err) {
      debug.error("admin: backup failed: %s", err.message);
      res.status(500).json({ error: apiWord(req, "settings.backupFailed") });
    }
  }));

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
    // Without Google sign-in and an approved Google admin, switching passwords off would lock everyone out of /admin.
    const wantsOff = body.passwordLogin === false || body.passwordLogin === "false" || (body.passwordLogin === null && envs.ENV_SETTINGS.passwordLogin === false);
    if (wantsOff) {
      if (!googleReady()) {
        return res.status(409).json({ error: apiWord(req, "settings.passwordLoginLocked"), field: "passwordLogin" });
      }
    }
    let changed;
    try {
      changed = serverSettings.save(body);
    } catch (err) {
      return res.status(400).json({ error: apiWord(req, "settings.badValue", { field: err.message }), field: err.message });
    }
    // A new direct address is checked at once, so the page shows whether it answers.
    if (changed.includes("publicDirectBaseUrl")) await directHealth.checkSoon();
    if (changed.some((k) => RESCAN.has(k))) {
      if (changed.includes("langPriority")) await titledbStore.load();
      shopCache.invalidate({ rename: true });
    } else if (changed.some((k) => REBUILD.has(k))) {
      shopCache.invalidate();
    }
    // The file check waiting for its hours looks again at once.
    if (changed.includes("verifyHours")) import("../../meta/verify-service.js").then((m) => m.default.pump()).catch(() => {});
    // The conversion queue stops when turned off and looks again after any of its settings.
    if (changed.some((k) => k.startsWith("nsz"))) await nszQueue.settingsChanged();
    // Turned on: the system folders and the guide appear at once, not at the next scan.
    if (changed.includes("retroScaffold") && envs.retroScaffold && fs.existsSync(envs.retroDir)) {
      retroCatalog.rescan(envs.retroDir).catch((err) => debug.error("admin: retro rescan after retroScaffold failed: %s", err.message));
    }
    // Turned on: the missing official cores are looked at now, not at the next scan.
    if (changed.includes("retroAutoCores") && envs.retroAutoCores && fs.existsSync(envs.retroDir)) {
      retroCatalog.current(envs.retroDir)
        .then(async (cat) => (await import("../../retro/auto-cores.js")).autoCores().then((a) => a.check(cat)))
        .catch((err) => debug.error("admin: official core check after retroAutoCores failed: %s", err.message));
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
    res.status(202).json({ ok: true, message: apiWord(req, "settings.titledbStarted") });
  }));
}
