/**
 * Server behaviour from the admin page's settings tab:
 *
 *   GET  /admin/api/server-settings                   { settings: { <name>: { value, source: "saved"|"env", envValue } }, titledb,
 *                                                       directDownload: { configured, up, since, checkedAt },
 *                                                       artFill: { enabled, titledb, plugin, files, tracked, missing, queued } }
 *   POST /admin/api/server-settings                   { <name>: value | null }  save (null = back to compose); applies at once
 *                                                     400 { error, field } when titledbSource or publicDirectBaseUrl points at a private network
 *                                                     403 { error, field } from an automation token naming a TOKEN_LOCKED setting
 *   POST /admin/api/server-settings/titledb-refresh   fetch titledb now, in the background
 *   POST /admin/api/server-settings/sync-now          read every library folder again now; { sync }
 *   POST /admin/api/server-settings/backup-now        make today's backup now; { backup }
 *
 * The GET also carries sync (meta/folder-sync.js status), backup (db/backup.js status) and
 * keys (security/prod-keys.js status; changed through admin/keys-api.js), with `library`
 * ({ above, known, unknown }, meta/key-needs.js): games whose files need a newer master key
 * generation than the keys reach, counted from generations already read in the background.
 *
 * The names are security/server-settings.js SETTINGS.
 */
import { artFiller } from "../../meta/art-filler.js";
import * as serverSettings from "../../security/server-settings.js";
import { libraryAbove } from "../../meta/key-needs.js";
import * as titledbStore from "../../meta/titledb-store.js";
import debug from "../../debug.js";
import * as directHealth from "../../security/direct-health.js";
import * as folderSync from "../../meta/folder-sync.js";
import * as backups from "../../db/backup.js";
import * as prodKeys from "../../security/prod-keys.js";
import { apiWord } from "./api-words.js";
import { securityError } from "../../security/security-messages.js";
import { applyServerSettings, SettingsRefusal, startTitledbRefresh, titledbFetching } from "./server-settings-apply.js";

// Who may sign in and how, the addresses consoles are sent to, and where the client build they
// install comes from, and how long an original stays after NSZ conversion (a token setting it to 0
// would delete each original as soon as it is converted, a high disk floor would purge every kept
// one): never changed with an automation token.
export const TOKEN_LOCKED = [
  "devicePairing", "passwordLogin", "deviceApproval", "deviceLimit", "enrollPerHour", "publicBaseUrl", "publicDirectBaseUrl", "directDownloads", "downloadLinkTtl",
  "clientSource", "clientReleaseRepo", "clientReleaseTag", "clientReleaseAsset",
  "nszKeepHours", "nszKeepGb", "nszDiskFloorGb", "mcpEnabled", "chatEnabled", "chatName", "chatPersona", "chatContextTokens",
];

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
  const keysView = () => {
    const keys = prodKeys.status();
    return keys.present ? { ...keys, library: libraryAbove(keys.maxGeneration) } : keys;
  };
  const view = () => ({
    settings: serverSettings.describe(),
    titledb: { ...titledbStore.status(), fetching: titledbFetching() },
    directDownload: directHealth.status(),
    sync: folderSync.status(),
    backup: backups.status(),
    keys: keysView(),
    // Pictures filled in for games whose files carry none: titles per source and games still without an icon.
    artFill: artFiller().status(),
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
    let changed;
    try {
      changed = await applyServerSettings(body);
    } catch (err) {
      if (!(err instanceof SettingsRefusal)) throw err;
      if (err.outbound) return res.status(400).json({ ...securityError(req, err.outbound), field: err.field });
      const error = err.word ? apiWord(req, err.word, err.wordArgs) : err.message;
      return res.status(err.status).json({ error, field: err.field });
    }
    res.json({ ok: true, changed, ...view() });
  }));

  router.post("/api/server-settings/titledb-refresh", handle((req, res) => {
    startTitledbRefresh();
    res.status(202).json({ ok: true, message: apiWord(req, "settings.titledbStarted") });
  }));
}
