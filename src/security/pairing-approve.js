/**
 * Approve the console behind a QR link: mint its access key, record who
 * approved it, and stage the key for the console's next status poll. Shared by
 * the admin page and the signed-in user's device-approval page.
 */
import * as store from "./store.js";
import { generateAccessKey, hashAccessKey, stageAccessKeyDelivery } from "./pairing.js";
import { readPairLink, finishPairLink } from "./pairing-link.js";

/** @returns {"ok" | "expired" | "used"} */
export function approvePairLink(token, { label = "", addedBy }) {
  const link = readPairLink(token);
  if (!link) return "expired";
  if (link.used || store.isDeviceApproved(link.deviceKey)) return "used";
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
