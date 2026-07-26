/**
 * "Which doors are open, and who can actually walk through them?"
 *
 * The failure this exists to prevent: pairing gets switched on, COOK_AUTH_USERS
 * is left empty, and stock Tinfoil — which has no way to present a device key —
 * is locked out of every download with nothing on screen explaining why. That
 * combination is legal and sometimes intended, so it isn't an error; it's a
 * state the operator must be able to SEE.
 *
 * Rendered on the dashboard and printed once at boot.
 */
import { devicePairing, authUsers } from "../helpers/envs.js";
import { getUsersFromEnv } from "../authUsersParser.js";
import { adminTotpEnabled } from "./admin-session.js";
import { secretSource, isEnrolled } from "./admin-secret.js";

export const SEVERITY = { WARN: "warn", INFO: "info" };

export function authLanes() {
  const users = Object.keys(getUsersFromEnv() ?? {});
  return {
    basicAuth: { enabled: Boolean(authUsers) && users.length > 0, userCount: users.length },
    pairing: { enabled: devicePairing },
    // deviceContentGuard only bites when pairing is the SOLE lane.
    pairingOnly: devicePairing && !authUsers,
    admin: {
      enabled: adminTotpEnabled(),
      secretSource: secretSource(),
      enrolled: isEnrolled(),
    },
  };
}

export function configWarnings(lanes = authLanes()) {
  const out = [];

  if (lanes.pairingOnly) {
    out.push({
      severity: SEVERITY.WARN,
      code: "pairing-only-blocks-tinfoil",
      title: "Pairing is the only lane — stock Tinfoil cannot connect",
      detail:
        "Downloads and the shop index are restricted to approved devices. Stock Tinfoil sends no device key, " +
        "so every request from it is refused (it usually shows this as an instant, empty 'Complete'). " +
        "Set COOK_AUTH_USERS=user:pass to reopen the password lane; pairing keeps working alongside it.",
    });
  }

  if (!lanes.basicAuth.enabled && !lanes.pairing.enabled) {
    out.push({
      severity: SEVERITY.WARN,
      code: "no-auth",
      title: "Server is open to anyone who knows the address",
      detail: "Neither COOK_AUTH_USERS nor COOK_DEVICE_PAIRING is configured.",
    });
  }

  if (lanes.admin.enabled && !lanes.admin.enrolled) {
    out.push({
      severity: SEVERITY.WARN,
      code: "admin-unenrolled",
      title: "Admin 2FA is not enrolled yet",
      detail:
        "A TOTP secret was generated automatically. Scan it from a device on your local network, " +
        "or copy the otpauth:// URI printed in the server log. The QR stops being served once enrolled.",
    });
  }

  if (lanes.pairing.enabled && lanes.basicAuth.enabled) {
    out.push({
      severity: SEVERITY.INFO,
      code: "both-lanes",
      title: "Both lanes active",
      detail:
        `Approved devices connect with no password; ${lanes.basicAuth.userCount} basic-auth ` +
        "account(s) cover Tinfoil and browsers.",
    });
  }

  return out;
}

/** One-line-per-warning boot log so a misconfiguration is loud before it bites. */
export function logConfigHealth(write = (s) => process.stdout.write(s)) {
  const lanes = authLanes();
  for (const w of configWarnings(lanes)) {
    if (w.severity !== SEVERITY.WARN) continue;
    write(`[oc-cookingfoil] WARNING: ${w.title}\n[oc-cookingfoil]   ${w.detail}\n`);
  }
  return lanes;
}
