/**
 * Approve the console behind a QR link: mint its access key, record who
 * approved it, and stage the key for the console's next status poll. Shared by
 * the admin page and the signed-in user's device-approval page.
 */
import * as store from "./store.js";
import { generateAccessKey, hashAccessKey, stageAccessKeyDelivery } from "./pairing.js";
import { readPairLink, finishPairLink } from "./pairing-link.js";
import { accountFull } from "./device-limit.js";
import { dropRepair, repairRequest } from "./pairing-repair.js";

/**
 * Approve a console that just signed in (COOK_DEVICE_AUTO_APPROVE): its key is
 * staged for its next status poll like a QR approval's. An account that holds
 * all the consoles it may (device-limit.js) gets none: "limit".
 * @returns {boolean | "limit"} whether it was newly approved
 */
export function approveSignedInDevice(deviceKey, addedBy) {
  if (!deviceKey || store.isDeviceApproved(deviceKey)) return false;
  if (accountFull(addedBy, deviceKey)) return "limit";
  const accessKey = generateAccessKey();
  store.approveDevice(deviceKey, { label: "자동 등록", addedBy, accessKeyHash: hashAccessKey(accessKey) });
  stageAccessKeyDelivery(deviceKey, accessKey);
  return true;
}

/**
 * Approve a console from the queue, or give an approved one a new key: mint its
 * access key and stage it for the console's next status poll. With no name
 * given, the console's own nickname names it, else the note it sent. A console
 * that came with a download is approved under that download's account, as the
 * download would have done. Shared by the admin page's devices tab and the
 * Telegram alert's button. Refused while that account holds all the consoles
 * it may (device-limit.js); a console already its own is given a new key.
 * @returns {{ ok: true, label: string } | { ok: false, limit: number }}
 */
export function approveWaitingDevice(deviceKey, { label = "", addedBy }) {
  const name = (String(label ?? "").trim() || store.pendingName(deviceKey) || store.pendingMessage(deviceKey) || "").slice(0, 64).trim();
  const owner = store.pendingDownload(deviceKey)?.owner ?? addedBy;
  const limit = accountFull(owner, deviceKey);
  if (limit) return { ok: false, limit };
  const accessKey = generateAccessKey();
  store.approveDevice(deviceKey, { label: name, addedBy: owner, accessKeyHash: hashAccessKey(accessKey) });
  stageAccessKeyDelivery(deviceKey, accessKey);
  return { ok: true, label: name };
}

/**
 * What a QR link's page offers: "confirm" while there is a console to approve,
 * "done" once there is nothing left. `repair` names the page's note for an
 * approved console that asked to be paired again (pairing-repair.js):
 * "repairOther" when `approver` is not the account it is registered to, else
 * "repairSame"; null for a console's first approval.
 * @returns {{ view: "confirm" | "done", repair: "repairSame" | "repairOther" | null }}
 */
export function pairLinkView(link, approver) {
  if (link.used) return { view: "done", repair: null };
  // A console's first approval needs its request still waiting: a dismissed one is over.
  if (!store.isDeviceApproved(link.deviceKey)) return { view: store.isDevicePending(link.deviceKey) ? "confirm" : "done", repair: null };
  if (!repairRequest(link.deviceKey)) return { view: "done", repair: null };
  return { view: "confirm", repair: store.deviceAddedBy(link.deviceKey) === approver ? "repairSame" : "repairOther" };
}

/**
 * Approve the console behind a QR link under `addedBy`. A console already
 * approved is approved again only when it asked to be re-paired: it gets a new
 * key (the old one stops), `addedBy` becomes its owner (an admin device moved
 * to another account is one no more), and the new key goes only to the
 * pairSecret that asked. "limit" while the approving account holds
 * all the consoles it may (device-limit.js; a console already its own does not
 * count again).
 * @returns {"ok" | "expired" | "used" | "limit"}
 */
export function approvePairLink(token, { label = "", addedBy }) {
  const link = readPairLink(token);
  if (!link) return "expired";
  const { view, repair } = pairLinkView(link, addedBy);
  if (view === "done") return "used";
  if (accountFull(addedBy, link.deviceKey)) return "limit";
  const name = String(label ?? "").slice(0, 64).trim();
  const accessKey = generateAccessKey();
  // The secret that asked for the re-pair, read while the console is still approved.
  const asked = repair ? repairRequest(link.deviceKey) : null;
  store.approveDevice(link.deviceKey, {
    label: repair && !name ? undefined : name,
    addedBy,
    accessKeyHash: hashAccessKey(accessKey),
    // An admin device stays one only with the account that made it so.
    admin: repair === "repairOther" ? false : undefined,
  });
  if (asked) store.replacePairSecret(link.deviceKey, asked.secretHash);
  dropRepair(link.deviceKey);
  stageAccessKeyDelivery(link.deviceKey, accessKey);
  finishPairLink(token);
  return "ok";
}
