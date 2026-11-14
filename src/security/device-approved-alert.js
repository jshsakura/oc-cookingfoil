/**
 * Tells the admin that a console was approved without them: an account approving it from the QR page, a
 * download's token enrolling it, or a sign-in approving it automatically. An approval the admin made on the
 * admin page or from a Telegram button is not told back to them.
 */
import { alert } from "../helpers/alerts.js";
import * as store from "./store.js";
import { deviceOwner } from "./device-owner.js";

const PLATFORM_NAMES = { switch: "Switch", vita: "PS Vita" };

/** `how` is "qr", "download" or "auto". */
export function alertDeviceApproved(deviceKey, how) {
  const owner = deviceOwner(deviceKey);
  const account = owner?.state === "bound" ? owner.owner.displayName : null;
  const name = store.deviceLabel(deviceKey);
  const platform = PLATFORM_NAMES[store.devicePlatform(deviceKey) ?? "switch"] ?? store.devicePlatform(deviceKey);
  alert("deviceApproved", (t) => t("deviceApproved", { account, name, platform, how: t(`approvedHow.${how}`) }), { subject: `${deviceKey}:${how}` });
}
