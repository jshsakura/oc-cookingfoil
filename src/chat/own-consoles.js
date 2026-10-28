/**
 * The consoles an account may send to from the chat: the ones it approved itself, never anyone
 * else's, and none that no account holds. The web page's "send to my console" button follows the same
 * rule (security/device-owner.js holds), so a person can neither list nor reach another account's
 * console, whatever the model is told.
 */
import * as store from "../security/store.js";
import * as sends from "../security/device-sends.js";
import { holds } from "../security/device-owner.js";
import { deviceCode, normalizeDeviceCode } from "../security/pairing-link.js";
import { tokenApprover } from "../security/admin-actor.js";
import { queueFile } from "../routes/device-sends.js";
import * as libraryCache from "../meta/library-cache.js";

const TITLE_RE = /^[0-9A-F]{16}$/;
const fail = (status, message) => Object.assign(new Error(message), { status });

/** The name sends are filed under for the account the chat runs as. */
export const approverOf = (owner) => tokenApprover(owner);

/** The account's own approved consoles: [{ deviceKey, code, label, sends }]; sends is whether its client takes sends. */
export function ownConsoles(approver) {
  return store.devicesSnapshot().approved
    .filter((d) => holds(approver, d.addedBy))
    .map((d) => ({ deviceKey: d.deviceKey, code: deviceCode(d.deviceKey), label: d.label || deviceCode(d.deviceKey), sends: sends.canReceive(d.deviceKey) }));
}

/** The base game's main file in the library, or null. The smallest path wins so the choice is stable. */
function mainFile(titleId) {
  const files = libraryCache.files().filter((f) => f.kind === "base" && f.baseTitleId === titleId).sort((a, b) => (a.rel < b.rel ? -1 : 1));
  return files[0] ?? null;
}

/**
 * Queues base game `game` for one of the account's own consoles. `device` is the console's
 * 8-character code; left out, it must be the only one the account has.
 * Returns { code, label, existing, item }; throws an Error with .status 400, 404, 409.
 */
export function sendGame(approver, { game, device }) {
  const titleId = String(game ?? "").toUpperCase();
  if (!TITLE_RE.test(titleId)) throw fail(400, "game must be a Switch base game's 16 hex digit title id, as games_search returns it");
  const mine = ownConsoles(approver);
  if (!mine.length) throw fail(404, "no console of yours is approved on this server");
  let target;
  if (device === undefined || device === null || device === "") {
    if (mine.length > 1) throw fail(400, `you have several consoles; name one by its code: ${mine.map((c) => `${c.label} (${c.code})`).join(", ")}`);
    target = mine[0];
  } else {
    const code = normalizeDeviceCode(device);
    target = code ? mine.find((c) => c.code === code) : null;
    if (!target) throw fail(404, "none of your consoles has that code");
  }
  if (!target.sends) throw fail(409, "that console's client has never asked for sends; update the client on it first");
  const file = mainFile(titleId);
  if (!file) throw fail(404, `no file of ${titleId} in the library`);
  const { item, existing } = queueFile(target.deviceKey, file.rel, approver);
  return { code: target.code, label: target.label, existing, item };
}
