/**
 * "Did this site's own page send it?" for writes and sockets. Browsers always
 * send Origin on a cross-site write and on every WebSocket upgrade; a console
 * or curl sends none, and is judged by its credentials alone.
 *
 * The site's origin is resolveOrigin's: COOK_PUBLIC_BASE_URL when pinned, else
 * the connection's Host (X-Forwarded-Host only from a trusted proxy).
 */
import { resolveOrigin } from "../helpers/origin.js";
import { publicBaseUrl } from "../helpers/envs.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const originOf = (req) => (typeof req.get === "function" ? req.get("Origin") : req.headers?.origin);

const hostOf = (url) => {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
};

/** No Origin, or exactly this site's origin. */
export function sameOrigin(req) {
  const origin = originOf(req);
  return !origin || origin === resolveOrigin(req, publicBaseUrl);
}

/**
 * The Origin's host is the host this request reached (or the pinned public
 * one). For the WebSocket upgrade, where the page may be opened on a LAN
 * address while COOK_PUBLIC_BASE_URL names the public one.
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
    res.set("Cache-Control", "no-store");
    res.status(403).json({ error: "origin mismatch" });
  };
}
