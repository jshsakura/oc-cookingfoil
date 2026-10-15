/**
 * Address classification shared by the guards.
 *
 * "Is this caller on my own machine / my own LAN?" is asked in several places
 * (lockout exemptions, the admin enrollment page). One definition, one place.
 */

export function isLoopbackIp(ip) {
  return ip === "127.0.0.1" || ip === "::1" || ip === "localhost" || /^127\./.test(ip ?? "");
}

/** The socket peer's address, ::ffff: stripped. Never X-Forwarded-For. */
export function socketIp(req) {
  return String(req?.socket?.remoteAddress ?? "").replace(/^::ffff:/, "");
}

/**
 * Whether the connection itself comes from this machine. Exemptions ("this is
 * the operator's own box") ask this, never req.ip: behind a proxy req.ip comes
 * from X-Forwarded-For, which a client can write as 127.0.0.1.
 */
export function isLoopbackSocket(req) {
  return isLoopbackIp(socketIp(req));
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

/**
 * Whether both the connection and the client it speaks for are inside the
 * house. req.ip alone is X-Forwarded-For behind a proxy, which a client may
 * write; the socket alone is the proxy for everyone behind it. Asking both
 * means a forwarded private address from a public connection never counts.
 */
export function isPrivateCaller(req) {
  const forwarded = String(req?.ip || "").replace(/^::ffff:/, "");
  if (!isPrivateIp(socketIp(req)) || (forwarded && !isPrivateIp(forwarded))) return false;
  // Every hop the request names: a proxy that appends (Cloudflare does) keeps
  // the client's own entries on the left, and req.ip may be one of those.
  const hops = String(req?.headers?.["x-forwarded-for"] ?? "").split(",").map((h) => h.trim().replace(/^::ffff:/, "")).filter(Boolean);
  return hops.every(isPrivateIp);
}
