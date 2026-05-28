/**
 * Drop obvious probe traffic at the door — before auth, before any handler.
 *
 * What we block:
 *   - Known attacker paths (env / .git / wp-admin / phpmyadmin / xmlrpc /
 *     vendor / server-status / cgi-bin / shell scripts).
 *   - Path traversal attempts (`..` segment in the decoded path).
 *   - Null bytes / control characters in the URL.
 *   - Request URI longer than 4 KB (we serve normal files, not crafted blobs).
 *
 * On a hit: respond 404 (don't confirm we noticed), count the IP toward
 * the same failure budget as bad auth — repeated probes get locked out too.
 */
import debug from "../debug.js";
import * as store from "./store.js";

const MAX_URI_LENGTH = 4096;

// Conservative. Tinfoil and the landing page never hit these.
const BAD_PATH_RE = [
  /^\/\.env(?:\..*)?$/i,
  /^\/\.git(\/|$)/i,
  /^\/wp-(?:admin|login|content|includes)/i,
  /^\/wp-config/i,
  /^\/phpmyadmin/i,
  /^\/pma\//i,
  /^\/xmlrpc\.php$/i,
  /^\/server-status$/i,
  /^\/vendor\//i,
  /^\/\.well-known\/(?!acme-challenge)/i,
  /^\/cgi-bin\//i,
  /^\/(boaform|console|manager|jmx-console)\//i,
  /\.(?:php|asp|aspx|jsp|cgi|sh|bash|py|rb|pl)$/i,
];

// Tools you reach for during an active attack. Honest curl/wget/Playwright
// are intentionally NOT in this list — too many false positives.
const BAD_UA_RE = /\b(?:sqlmap|nikto|nessus|acunetix|wpscan|nuclei|gobuster|dirbuster|wfuzz|fimap|masscan|zgrab|hydra)\b/i;

function clientIp(req) {
  const raw = req.ip || req.socket?.remoteAddress || "unknown";
  return raw.replace(/^::ffff:/, "");
}

const TRUST_LOOPBACK = process.env.COOK_LOCKOUT_TRUST_LOOPBACK !== "false";
function isLoopback(ip) {
  return TRUST_LOOPBACK && (ip === "127.0.0.1" || ip === "::1" || ip === "localhost");
}

function flag(req, reason) {
  const ip = clientIp(req);
  store.appendAudit({ kind: "probe", ip, path: req.path, ua: req.get("user-agent") || "", reason, at: Date.now() });
  debug.error("security: probe blocked from %s — %s (%s)", ip, reason, req.path);

  // Probes burn the same budget as bad credentials. Several probes from
  // the same IP → lockout.
  const prev = store.getFailure(ip) ?? { count: 0, firstAt: Date.now() };
  const next = { count: prev.count + 1, firstAt: prev.firstAt, lastAt: Date.now(), lastPath: req.path };
  store.setFailure(ip, next);
  const MAX = Math.max(1, Number(process.env.COOK_AUTH_MAX_FAILURES ?? 5));
  if (next.count >= MAX) {
    store.lock(ip, { reason: `probe: ${reason}`, ttlMs: 0 });
    debug.error("security: %s LOCKED OUT after %d probe(s)", ip, next.count);
  }
}

export default function accessGuard() {
  return (req, res, next) => {
    const ip = clientIp(req);

    // Loopback bypass — let local dev / test runners hit any path without
    // burning the lockout budget.
    if (isLoopback(ip)) {
      return next();
    }

    // Locked IPs get the cold shoulder for ALL requests — landing page too,
    // not only auth-protected routes.
    if (store.isLocked(ip)) {
      res.set("Cache-Control", "no-store");
      res.status(429).type("text/plain").send("Locked out — contact administrator.");
      return;
    }

    if (typeof req.originalUrl === "string" && req.originalUrl.length > MAX_URI_LENGTH) {
      flag(req, "uri-too-long");
      return res.status(414).type("text/plain").send("URI too long.");
    }

    // Decoded path probe — defends against `%2e%2e%2f` style smuggling.
    let decoded;
    try { decoded = decodeURIComponent(req.path); } catch { decoded = req.path; }
    if (/\0/.test(decoded) || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(decoded)) {
      flag(req, "control-char");
      return res.status(404).end();
    }
    if (/(^|\/)\.\.(\/|$)/.test(decoded)) {
      flag(req, "path-traversal");
      return res.status(404).end();
    }

    for (const re of BAD_PATH_RE) {
      if (re.test(req.path)) {
        flag(req, "bad-path");
        return res.status(404).end();
      }
    }

    const ua = req.get("user-agent") || "";
    if (ua && BAD_UA_RE.test(ua)) {
      flag(req, "bad-ua");
      return res.status(404).end();
    }

    next();
  };
}
