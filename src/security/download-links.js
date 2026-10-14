/**
 * Download URLs on the direct address, for clients that ask for them.
 *
 * When the admin sets a direct address (server-settings publicDirectBaseUrl,
 * e.g. https://dl.example.org:38443, a proxy on this host that forwards only
 * GET/HEAD requests carrying `Authorization: Bearer …` here), a signed-in
 * client that sends
 *
 *   X-CookingFoil-Features: direct-token
 *
 * gets, on every response after the sign-in (304s included),
 *
 *   X-CookingFoil-Download-Token: <token>          (download-token.js)
 *
 * and every download URL in its lists points at the direct address, with the
 * same path and query as the normal URL and nothing added:
 *
 *   "url": "https://dl.example.org:38443/Game%2Ffile.nsp"
 *
 * so a list is the same on every refresh and its ETag does not move with the
 * token. The client sends the token as a Bearer header there (direct-lane.js).
 *
 * Clients that don't declare the feature (Tinfoil, CyberFoil, browsers), a
 * request that did not sign in, or an empty setting: the lists and headers are
 * exactly what they were before direct downloads existed.
 */
import * as env from "../helpers/envs.js";
import debug from "../debug.js";
import * as identity from "./link-identity.js";
import * as tokens from "./download-token.js";

export const FEATURES_HEADER = "X-CookingFoil-Features";
export const TOKEN_HEADER = "X-CookingFoil-Download-Token";
export const FEATURE = "direct-token";

/** Whether the request declares the direct-token feature. */
export function wantsDirect(req) {
  const raw = String(req.get?.(FEATURES_HEADER) ?? "");
  return raw.split(/[\s,]+/).some((f) => f.toLowerCase() === FEATURE);
}

let keyBroken = false;

function keyUsable() {
  try {
    tokens.signingKey();
    keyBroken = false;
    return true;
  } catch (err) {
    if (!keyBroken) debug.error("direct downloads: no signing key, lists keep their normal URLs: %s", err.message);
    keyBroken = true;
    return false;
  }
}

/**
 * { base, who } when this request's lists use the direct address: a direct
 * address is set, the client declared the feature, it signed in and a token
 * can be made. null otherwise, and everything stays as it was.
 */
export function forRequest(req) {
  const base = env.publicDirectBaseUrl;
  if (!base || !wantsDirect(req)) return null;
  const who = identity.requester(req);
  if (!who || !keyUsable()) return null;
  return { base, who };
}

/** `url` ("/api/…", percent-encoded) on the direct address when `link` is set; otherwise, or for null, unchanged. Pure. */
export function directUrl(url, link) {
  if (!link || typeof url !== "string" || !url.startsWith("/") || url.startsWith("//")) return url;
  return `${link.base}${url}`;
}

/**
 * Puts the file entries of a serialized shop list ("../…", variants included)
 * on the direct address. Runs before helpers/origin.js anchors the remaining
 * "../" URLs at the origin, so with a link there are none left.
 */
export function withShopDirect(json, link) {
  return link ? json.replaceAll('"../', `"${link.base}/`) : json;
}

/** Sets the token header on every signed-in response to a client that asked for it. */
export function tokenHeader() {
  return (req, res, next) => {
    const link = forRequest(req);
    if (link) res.set(TOKEN_HEADER, tokens.issue(link.who));
    next();
  };
}
