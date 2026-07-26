/**
 * Address classification shared by the guards.
 *
 * "Is this caller on my own machine / my own LAN?" is asked in several places
 * (lockout exemptions, the admin enrollment page). One definition, one place.
 */

export function isLoopbackIp(ip) {
  return ip === "127.0.0.1" || ip === "::1" || ip === "localhost" || /^127\./.test(ip ?? "");
}

/**
 * RFC1918 / CGNAT / link-local / unique-local — i.e. "someone already inside
 * the house". Not a security boundary on its own; used to decide what we're
 * willing to SHOW, never what we're willing to change.
 */
export function isPrivateIp(ip) {
  if (!ip) return false;
  if (isLoopbackIp(ip)) return true;
  const v4 = ip.replace(/^::ffff:/, "");
  if (/^10\./.test(v4)) return true;
  if (/^192\.168\./.test(v4)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(v4)) return true;
  if (/^169\.254\./.test(v4)) return true; // link-local
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(v4)) return true; // CGNAT (Tailscale et al.)
  if (/^f[cd][0-9a-f]{2}:/i.test(ip)) return true; // unique-local IPv6
  if (/^fe80:/i.test(ip)) return true; // link-local IPv6
  return false;
}
