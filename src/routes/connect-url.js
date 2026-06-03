/**
 * GET /api/connect-url
 *
 * Returns the ready-to-paste shop URL for the CURRENTLY authenticated visitor:
 *   { url: "https://user:pass@host:port/shop.tfl", hasAuth: true }
 *
 * The browser already holds the basic-auth credentials (it sent them to reach
 * this authenticated endpoint), so we decode the Authorization header and weave
 * the real user:pass into the origin the request actually arrived on. That lets
 * the dashboard show a copy-paste-ready URL instead of a "user:pass@host"
 * placeholder the operator has to hand-edit.
 *
 * Security: the response echoes the caller's OWN password back to the caller
 * (who just typed it) over the same authenticated channel — no third party
 * sees it. Marked no-store and the credentials are never logged.
 */
import { resolveOrigin } from "../helpers/origin.js";
import { publicBaseUrl } from "../helpers/envs.js";

function decodeBasicAuth(req) {
  const header = req.headers.authorization || "";
  const match = /^Basic\s+(.+)$/i.exec(header);
  if (!match) return null;
  let decoded;
  try {
    decoded = Buffer.from(match[1], "base64").toString("utf-8");
  } catch {
    return null;
  }
  const sep = decoded.indexOf(":");
  if (sep < 0) return null;
  return { user: decoded.slice(0, sep), pass: decoded.slice(sep + 1) };
}

export default function connectUrlRoute(req, res) {
  res.set("Cache-Control", "no-store");

  const origin = resolveOrigin(req, publicBaseUrl); // "proto://host" or ""
  const creds = decodeBasicAuth(req);

  let url = null;
  if (origin) {
    if (creds) {
      const user = encodeURIComponent(creds.user);
      const pass = encodeURIComponent(creds.pass);
      url = origin.replace(/^([a-z]+:\/\/)/i, `$1${user}:${pass}@`) + "/shop.tfl";
    } else {
      url = origin + "/shop.tfl";
    }
  }

  res.status(200).json({ url, hasAuth: Boolean(creds) });
}
