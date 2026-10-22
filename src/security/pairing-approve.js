/**
 * Approve the console behind a QR link: mint its access key, record who
 * approved it, and stage the key for the console's next status poll. Shared by
 * the admin page and the signed-in user's device-approval page.
 */
import * as store from "./store.js";
import { generateAccessKey, hashAccessKey, stageAccessKeyDelivery } from "./pairing.js";
import { readPairLink, finishPairLink } from "./pairing-link.js";
import { accountFull } from "./device-limit.js";

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

/** "limit" while the approving account holds all the consoles it may (device-limit.js). @returns {"ok" | "expired" | "used" | "limit"} */
export function approvePairLink(token, { label = "", addedBy }) {
  const link = readPairLink(token);
  if (!link) return "expired";
  if (link.used || store.isDeviceApproved(link.deviceKey)) return "used";
  if (accountFull(addedBy, link.deviceKey)) return "limit";
  const accessKey = generateAccessKey();
  store.approveDevice(link.deviceKey, {
    label: String(label ?? "").slice(0, 64).trim(),
    addedBy,
    accessKeyHash: hashAccessKey(accessKey),
  });
  stageAccessKeyDelivery(link.deviceKey, accessKey);
  finishPairLink(token);
  return "ok";
}
