/**
 * The canonical vocabulary of "why a request was refused".
 *
 * Every guard that turns a request away tags it with one of these. The reason
 * travels three ways, so a refusal is never silent:
 *   1. into the persisted denial log  → the /admin dashboard
 *   2. onto the response as `X-CookingFoil-Deny` → visible in `curl -v`
 *   3. into the server log            → docker compose logs
 *
 * `hint` is operator-facing: it answers "what do I change to fix this?", which
 * is the whole point of surfacing denials at all.
 */
export const DENY = {
  RATE_LIMITED: "rate-limited",
  IP_LOCKED: "ip-locked",
  PROBE: "probe",
  BAD_CREDENTIALS: "bad-credentials",
  NO_DEVICE_KEY: "no-device-key",
  DEVICE_NOT_APPROVED: "device-not-approved",
  DEVICE_BAD_ACCESS_KEY: "device-bad-access-key",
  ADMIN_NO_SESSION: "admin-no-session",
  ADMIN_BAD_TOTP: "admin-bad-totp",
};

const HINTS = {
  [DENY.RATE_LIMITED]:
    "Client exceeded COOK_RATE_LIMIT_PER_MIN. Raise it if this is normal traffic.",
  [DENY.IP_LOCKED]:
    "IP is locked out after repeated failures. Unlock it from this dashboard, or boot once with COOK_RESET_LOCKOUTS=true.",
  [DENY.PROBE]:
    "Request matched a scanner/traversal pattern and was dropped before auth.",
  [DENY.BAD_CREDENTIALS]:
    "Wrong basic-auth user/password. Check the client against COOK_AUTH_USERS.",
  [DENY.NO_DEVICE_KEY]:
    "Client sent no device key, and pairing is the only lane. Stock Tinfoil CANNOT pair — set COOK_AUTH_USERS to give it a password lane.",
  [DENY.DEVICE_NOT_APPROVED]:
    "Device knocked but is not approved yet. Approve it in the Devices table.",
  [DENY.DEVICE_BAD_ACCESS_KEY]:
    "Device presented a stale or wrong access key. Re-issue its key.",
  [DENY.ADMIN_NO_SESSION]: "Admin request without a valid 2FA session.",
  [DENY.ADMIN_BAD_TOTP]: "Wrong 6-digit code at the admin gate.",
};

export function hintFor(reason) {
  return HINTS[reason] ?? "";
}
