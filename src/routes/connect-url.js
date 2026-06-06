/**
 * GET /api/connect-url
 *
 * Returns the ready-to-paste shop URL for the CURRENTLY authenticated visitor:
 *   { url: "https://host:port/shop.tfl", hasAuth: true, username: "tinfoil" }
 *
 * The URL is CLEAN — the password is never woven into it. Credentials in a URL
 * leak through browser history, proxy/access logs, and Referer headers, and most
 * clients (Tinfoil/CyberFoil) want them in their own Username/Password fields
 * anyway. We surface the username (handy, low-risk) but the visitor types their
 * own password into the client; the server never echoes it back.
 *
 * Security: marked no-store; the password is neither returned nor logged.
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

  // Clean URL only — never embed the password (history/log/Referer leak).
  const url = origin ? origin + "/shop.tfl" : null;

  res.status(200).json({
    url,
    hasAuth: Boolean(creds),
    username: creds ? creds.user : null,
  });
}
