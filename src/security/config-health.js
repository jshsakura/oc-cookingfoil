/**
 * "Which doors are open, and who can actually walk through them?"
 *
 * A configuration that leaves the server open, or the admin page without its
 * second factor, is legal and sometimes intended, so it isn't an error; it's a
 * state the operator must be able to SEE.
 *
 * Rendered on the dashboard and printed once at boot.
 */
import { devicePairing } from "../helpers/envs.js";
import * as users from "./users.js";
import { adminTotpEnabled, adminOwner, adminPasswordMode } from "./admin-session.js";
import { secretSource, isEnrolled } from "./admin-secret.js";
import { adminEmail } from "../helpers/envs.js";
import { proxyCollapseObserved } from "./proxy-check.js";

export const SEVERITY = { WARN: "warn", INFO: "info" };

export function authLanes() {
  const enabled = users.list().filter((u) => u.enabled).length;
  return {
    accounts: { enabled: enabled > 0, userCount: enabled },
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

  if (!lanes.accounts.enabled && !lanes.pairing.enabled) {
    out.push({
      severity: SEVERITY.WARN,
      code: "no-auth",
      title: "Server is open to anyone who knows the address",
      detail: "Neither COOK_AUTH_USERS nor COOK_DEVICE_PAIRING is configured.",
    });
  }

  if (lanes.admin.enabled && !lanes.admin.enrolled && adminPasswordMode()) {
    // The admin password already guards the page; an authenticator is an extra step.
    out.push({
      severity: SEVERITY.INFO,
      code: "admin-authenticator-optional",
      title: "The admin page opens with the admin password only",
      detail: "Enroll an authenticator app on the admin page's settings tab to open it with a 6-digit code instead.",
    });
  } else if (lanes.admin.enabled && !lanes.admin.enrolled) {
    out.push({
      severity: SEVERITY.WARN,
      code: "admin-unenrolled",
      title: "Admin 2FA is not enrolled yet",
      detail:
        "Register an authenticator in the admin page's settings tab (or open /admin from your local network). " +
        "The key is shown only there, never in the server log.",
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

  if (lanes.pairing.enabled && lanes.accounts.enabled) {
    out.push({
      severity: SEVERITY.INFO,
      code: "both-lanes",
      title: "Both lanes active",
      detail:
        `Approved devices connect with their keys; ${lanes.accounts.userCount} ` +
        "account(s) sign in on the web page.",
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
