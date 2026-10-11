/**
 * What a per-device login may reach: reading the shop (index, sections, titles,
 * artwork, patches) and downloading games. Never the pages that issue logins,
 * approve consoles, change the library or hand out the shop's own credentials.
 */
const READ_METHODS = new Set(["GET", "HEAD"]);
const BLOCKED_PREFIXES = [
  "/admin", "/api/admin", "/pair", "/api/pair", "/api/connect-url", "/api/client-config",
  "/api/uploads", "/api/dropbox",
];

export function deviceLoginAllowed(req) {
  if (!READ_METHODS.has(req.method)) return false;
  const path = req.path.toLowerCase();
  return !BLOCKED_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix + "/"));
}
