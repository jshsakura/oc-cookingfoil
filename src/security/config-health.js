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
import { devicePairing } from "../helpers/envs.js";
import * as users from "./users.js";
import { adminTotpEnabled, adminOwner } from "./admin-session.js";
import { secretSource, isEnrolled } from "./admin-secret.js";
import { adminEmail } from "../helpers/envs.js";
import { proxyCollapseObserved } from "./proxy-check.js";

export const SEVERITY = { WARN: "warn", INFO: "info" };

export function authLanes() {
  const enabled = users.list().filter((u) => u.enabled).length;
  return {
    basicAuth: { enabled: enabled > 0, userCount: enabled },
    pairing: { enabled: devicePairing },
    // deviceContentGuard only bites when pairing is the SOLE lane.
    pairingOnly: devicePairing && !users.hasUsers(),
    admin: {
      enabled: adminTotpEnabled(),
      secretSource: secretSource(),
      enrolled: isEnrolled(),
      owner: adminOwner(),
      email: adminEmail,
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

  if (proxyCollapseObserved()) {
    out.push({
      severity: SEVERITY.WARN,
      code: "proxy-collapse",
      title: "Requests arrive through a proxy, but COOK_TRUST_PROXY is not set",
      detail:
        "Every client is being counted as the proxy's single IP, so they share one rate-limit " +
        "budget and one lockout counter — one stranger's failures can throttle or lock out " +
        "everyone. Set COOK_TRUST_PROXY (true, or proxy hops like loopback, uniquelocal) and have the proxy forward X-Forwarded-For.",
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
  write(`[oc-cookingfoil] admin: ${lanes.admin.owner}\n`);
  for (const w of configWarnings(lanes)) {
    if (w.severity !== SEVERITY.WARN) continue;
    write(`[oc-cookingfoil] WARNING: ${w.title}\n[oc-cookingfoil]   ${w.detail}\n`);
  }
  return lanes;
}
