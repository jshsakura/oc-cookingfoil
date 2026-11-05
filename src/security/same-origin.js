/**
 * "Did this site's own page send it?" for writes and sockets. Browsers always
 * send Origin on a cross-site write and on every WebSocket upgrade; a console
 * or curl sends none, and is judged by its credentials alone.
 *
 * The site is the host the request reached (X-Forwarded-Host only from a trusted
 * proxy) and COOK_PUBLIC_BASE_URL when pinned. Both count: a page opened on a LAN
 * address, or a typo in the public address, must not refuse the save that fixes it.
 * Sessions are bound to the host, so another site pointing its name here holds none.
 */
import { resolveOrigin } from "../helpers/origin.js";
import { publicBaseUrl } from "../helpers/envs.js";
import { noteRefusal } from "./auth-log.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const originOf = (req) => (typeof req.get === "function" ? req.get("Origin") : req.headers?.origin);

const hostOf = (url) => {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
};

/** No Origin, or a page of this site. */
export function sameOrigin(req) {
  return !originOf(req) || sameHost(req) === true;
}

/**
 * The Origin's host is the host this request reached (or the pinned public one).
 * @returns {boolean | null} null when no Origin was sent (not a browser)
 */
export function sameHost(req) {
  const origin = originOf(req);
  if (!origin) return null;
  const host = hostOf(origin);
  if (!host) return false;
  return host === hostOf(resolveOrigin(req, null)) || (Boolean(publicBaseUrl) && host === hostOf(publicBaseUrl));
}

/** Middleware: a state-changing request from another site's page gets 403 before any handler. */
export function sameOriginWrites() {
  return (req, res, next) => {
    if (SAFE_METHODS.has(req.method) || sameOrigin(req)) return next();
    noteRefusal(req, res, 403, "origin-mismatch");
    res.set("Cache-Control", "no-store");
    res.status(403).json({ error: "origin mismatch" });
  };
}
