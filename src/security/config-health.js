/**
 * "Which doors are open, and who can actually walk through them?"
 *
 * A configuration that leaves the server open, or the admin page without its
 * second factor, is legal and sometimes intended, so it isn't an error; it's a
 * state the operator must be able to SEE.
 *
 * Rendered on the dashboard and printed once at boot.
 */
import * as twoFactorSkip from "./admin-2fa-skip.js";
import { devicePairing } from "../helpers/envs.js";
import * as users from "./users.js";
import { adminTotpEnabled, adminOwner, adminPasswordMode } from "./admin-session.js";
import { secretSource, isEnrolled } from "./admin-secret.js";
import { adminEmail } from "../helpers/envs.js";
import { proxyCollapseObserved } from "./proxy-check.js";
import { ready as keysReady } from "./prod-keys.js";
import { layout as storageLayout } from "../helpers/envs.js";
import { ROLES, oldIncoming } from "../helpers/storage-layout.js";

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

/** The storage folder's warnings: roles still read from an old mount, and an old drop box left in the games folder. */
export function storageWarnings(layout = storageLayout, leftBox = oldIncoming(layout)) {
  const out = [];
  const kept = ROLES.filter((r) => layout.from[r] === "kept");
  if (kept.length) {
    out.push({
      severity: SEVERITY.WARN,
      code: "storage-kept",
      title: "Some folders are still read from their old mounts",
      detail: `The storage folder ${layout.root} is mounted, but ${kept.map((r) => `${r} (${layout.dirs[r]})`).join(", ")} still hold files at the old place, so the server keeps using them. Move their contents into ${layout.root}/<name> and drop the old mounts.`,
      paths: kept.map((r) => ({ role: r, now: layout.dirs[r], want: `${layout.root}/${r}` })),
    });
  }
  if (leftBox) {
    out.push({
      severity: SEVERITY.WARN,
      code: "old-incoming",
      title: "Files are left in the old drop box inside the games folder",
      detail: `${leftBox} could not be moved into ${layout.dirs.incoming} because the same names are already there. They are not listed or sorted until moved.`,
      paths: [{ role: "incoming", now: leftBox, want: layout.dirs.incoming }],
    });
  }
  return out;
}

export function configWarnings(lanes = authLanes(), { keys = keysReady() } = {}) {
  const out = [...storageWarnings()];

  if (!keys) {
    out.push({
      severity: SEVERITY.WARN,
      code: "no-prod-keys",
      title: "No prod.keys: Switch game files cannot be read",
      detail: "Games are known only by the [TITLEID][vN] in their file names; names and icons from the files, NSZ conversion and home-screen shortcuts are unavailable. Retro, homebrew, saves and patches work as usual. Hand prod.keys in on the admin page's settings tab, or mount it at COOK_PROD_KEYS_PATH; it applies at once, no restart.",
    });
  }

  if (!lanes.accounts.enabled && !lanes.pairing.enabled) {
    out.push({
      severity: SEVERITY.WARN,
      code: "no-auth",
      title: "Server is open to anyone who knows the address",
      detail: "Neither COOK_AUTH_USERS nor COOK_DEVICE_PAIRING is configured.",
    });
  }

  if (lanes.admin.enabled && !lanes.admin.enrolled && twoFactorSkip.skipped() && !adminPasswordMode()) {
    out.push({
      severity: SEVERITY.WARN,
      code: "admin-2fa-skipped",
      title: "Admin 2FA was skipped: the admin page opens with the account password alone",
      detail: "Anyone who learns the admin account's password can run this server. Register an authenticator on the admin page's settings tab.",
    });
  } else if (lanes.admin.enabled && !lanes.admin.enrolled && adminPasswordMode()) {
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
