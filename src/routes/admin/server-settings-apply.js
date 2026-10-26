/**
 * Saving server settings with everything a change sets going: the one place the admin page's route
 * and the MCP tool both go through. It does not decide who may change what (TOKEN_LOCKED is the
 * caller's check), and it refuses with a SettingsRefusal the route turns into its answer.
 */
import fs from "fs";
import * as serverSettings from "../../security/server-settings.js";
import * as libraryCache from "../../meta/library-cache.js";
import { artFiller } from "../../meta/art-filler.js";
import nszQueue from "../../meta/nsz-service.js";
import * as titledbStore from "../../meta/titledb-store.js";
import { refresh as refreshTitledb } from "../../meta/titledb-bootstrap.js";
import debug from "../../debug.js";
import * as directHealth from "../../security/direct-health.js";
import { checkOutboundUrl, OutboundError } from "../../security/outbound-guard.js";
import { googleReady } from "../../security/password-policy.js";
import * as envs from "../../helpers/envs.js";
import * as retroCatalog from "../../retro/catalog.js";

// Settings baked into the list the server hands out: rebuild it after a change.
const REBUILD = new Set(["publicBaseUrl", "publicDirectBaseUrl", "directDownloads", "downloadLinkTtl", "fillMissingArt"]);
// Addresses the server fetches itself: refused when they point at a private network.
const OUTBOUND = ["titledbSource", "publicDirectBaseUrl", "retroPackUrl"];
// Settings that change the names themselves: reload titledb and read every file again.
const RESCAN = new Set(["langPriority", "extractIcons"]);

/** A refused save: `status`, the `field` at fault, and either a word key for the route or the OutboundError behind it. */
export class SettingsRefusal extends Error {
  constructor(message, { status = 400, field, word, wordArgs, outbound } = {}) {
    super(message);
    Object.assign(this, { status, field, word, wordArgs, outbound });
  }
}

let fetching = null;

/** Whether a titledb fetch started from here is running. */
export const titledbFetching = () => Boolean(fetching);

/** Starts the titledb fetch in the background unless one is running; true when this call started it. */
export function startTitledbRefresh() {
  if (fetching) return false;
  fetching = refreshTitledb()
    .then((results) => debug.log("admin: titledb fetched (%d regions ok)", results.filter((r) => r.ok).length))
    .catch((err) => debug.error("admin: titledb fetch failed: %s", err.message))
    .finally(() => { fetching = null; });
  return true;
}

/** Saves `body` ({ name: value | null }) and starts what each change needs. @returns {Promise<string[]>} the names that changed */
export async function applyServerSettings(body) {
  for (const field of OUTBOUND) {
    const value = typeof body[field] === "string" ? body[field].trim().replace(/\/+$/, "") : "";
    // Only a new address: saving another setting must not hinge on this one's DNS.
    // A malformed value is left to save(), which names the field as usual.
    if (!/^https?:\/\/\S+$/.test(value) || value === serverSettings.describe()[field]?.value) continue;
    try {
      await checkOutboundUrl(value);
    } catch (err) {
      if (!(err instanceof OutboundError)) throw err;
      throw new SettingsRefusal(err.message, { field, outbound: err });
    }
  }
  // Without Google sign-in and an approved Google admin, switching passwords off would lock everyone out of /admin.
  const wantsOff = body.passwordLogin === false || body.passwordLogin === "false" || (body.passwordLogin === null && envs.ENV_SETTINGS.passwordLogin === false);
  if (wantsOff && !googleReady()) {
    throw new SettingsRefusal("Switching passwords off needs Google sign-in set up with an approved Google admin; otherwise nobody could open the admin page", { status: 409, field: "passwordLogin", word: "settings.passwordLoginLocked" });
  }
  let changed;
  try {
    changed = serverSettings.save(body);
  } catch (err) {
    throw new SettingsRefusal(`Setting ${err.message} does not accept that value`, { field: err.message, word: "settings.badValue", wordArgs: { field: err.message } });
  }
  // A new direct address is checked at once, so the page shows whether it answers.
  if (changed.includes("publicDirectBaseUrl")) await directHealth.checkSoon();
  if (changed.some((k) => RESCAN.has(k))) {
    if (changed.includes("langPriority")) await titledbStore.load();
    libraryCache.invalidate({ rename: true });
  } else if (changed.some((k) => REBUILD.has(k))) {
    libraryCache.invalidate();
  }
  // On: everything the library knows is looked at again for missing pictures. Off: the queue empties and what was kept stops being shown.
  if (changed.includes("fillMissingArt")) artFiller().settingChanged();
  // The file check waiting for its hours looks again at once.
  if (changed.includes("verifyHours")) import("../../meta/verify-service.js").then((m) => m.default.pump()).catch(() => {});
  // The conversion queue stops when turned off and looks again after any of its settings.
  if (changed.some((k) => k.startsWith("nsz"))) await nszQueue.settingsChanged();
  // Turned on: the system folders and the guide appear at once, not at the next scan.
  if (changed.includes("retroScaffold") && envs.retroScaffold && fs.existsSync(envs.retroDir)) {
    retroCatalog.rescan(envs.retroDir).catch((err) => debug.error("admin: retro rescan after retroScaffold failed: %s", err.message));
  }
  // Turned on: a rescan lets the box art watcher (retro/art/auto.js) look at the games without any now.
  if (changed.includes("retroAutoArt") && envs.retroAutoArt && fs.existsSync(envs.retroDir)) {
    retroCatalog.rescan(envs.retroDir).catch((err) => debug.error("admin: retro rescan after retroAutoArt failed: %s", err.message));
  }
  // Turned on: the missing official cores are looked at now, not at the next scan.
  if (changed.includes("retroAutoCores") && envs.retroAutoCores && fs.existsSync(envs.retroDir)) {
    retroCatalog.current(envs.retroDir)
      .then(async (cat) => (await import("../../retro/auto-cores.js")).autoCores().then((a) => a.check(cat)))
      .catch((err) => debug.error("admin: official core check after retroAutoCores failed: %s", err.message));
  }
  if (changed.length) debug.log("admin: server settings changed: %s", changed.join(", "));
  return changed;
}
