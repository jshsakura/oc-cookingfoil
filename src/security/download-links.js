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
 *   X-CookingFoil-Download-Origin: https://dl.example.org:38443   (where it goes, and nowhere else)
 *
 * and every download URL in its lists points at the direct address, with the
 * same path and query as the normal URL and nothing added:
 *
 *   "url": "https://dl.example.org:38443/Game%2Ffile.nsp"
 *
 * so a list is the same on every refresh and its ETag does not move with the
 * token. The client sends the token as a Bearer header there (direct-lane.js).
 *
 * Only a request whose effective scheme is https takes this (effectiveScheme:
 * X-Forwarded-Proto counts only from a peer the trust-proxy setting trusts,
 * as in Express's req.protocol). A request over plain http (a console at home
 * talking to the server's own address) is already on the short path: it keeps
 * its same-origin URLs and gets no token.
 *
 * The direct port admits only Korean addresses. A request that came through
 * Cloudflare says where its client is (CF-IPCountry, believed only from a peer
 * the trust-proxy setting trusts); one from outside KR keeps today's URLs and
 * gets no token, since the direct address would refuse it. No header (a
 * request that didn't come through Cloudflare): the scheme alone decides.
 * Both rules are one pure function, routesDirect.
 *
 * Clients that don't declare the feature (Tinfoil, CyberFoil, browsers), a
 * request over http or one that did not sign in, or an empty setting: the
 * lists and headers are exactly what they were before direct downloads existed.
 */
import * as env from "../helpers/envs.js";
import debug from "../debug.js";
import * as identity from "./link-identity.js";
import * as tokens from "./download-token.js";
import { knownDown } from "./direct-health.js";

export const FEATURES_HEADER = "X-CookingFoil-Features";
export const TOKEN_HEADER = "X-CookingFoil-Download-Token";
// The one origin (scheme, host, port) the token may be sent to, so a client
// never hands it to another https host a list names (a mirror, a homebrew release).
export const ORIGIN_HEADER = "X-CookingFoil-Download-Origin";
export const FEATURE = "direct-token";

/** Whether the request declares the direct-token feature. */
export function wantsDirect(req) {
  const raw = String(req.get?.(FEATURES_HEADER) ?? "");
  return raw.split(/[\s,]+/).some((f) => f.toLowerCase() === FEATURE);
}

/**
 * The scheme a request was made with: the first X-Forwarded-Proto value when
 * the immediate peer is a trusted proxy and sent one, else the socket's own.
 * The same rule as Express's req.protocol. Pure.
 */
export function effectiveScheme({ encrypted = false, forwardedProto, peerTrusted = false } = {}) {
  if (peerTrusted && forwardedProto) {
    const first = String(forwardedProto).split(",")[0].trim().toLowerCase();
    if (first) return first;
  }
  return encrypted ? "https" : "http";
}

// The only country the direct port lets in.
const DIRECT_COUNTRY = "KR";

/**
 * Whether a request's lists may point at the direct address: it came over
 * https (effectiveScheme), and when a trusted peer passed on Cloudflare's
 * CF-IPCountry, that country is KR. Pure.
 */
export function routesDirect({ encrypted = false, forwardedProto, peerTrusted = false, country } = {}) {
  if (effectiveScheme({ encrypted, forwardedProto, peerTrusted }) !== "https") return false;
  const where = peerTrusted ? String(country ?? "").trim().toUpperCase() : "";
  return !where || where === DIRECT_COUNTRY;
}

/** What routesDirect reads, from a request. */
function routeInputs(req) {
  const trust = req.app?.get?.("trust proxy fn");
  const peer = req.socket?.remoteAddress;
  return {
    encrypted: Boolean(req.socket?.encrypted),
    forwardedProto: req.get?.("x-forwarded-proto"),
    peerTrusted: Boolean(trust?.(peer, 0)),
    country: req.get?.("cf-ipcountry"),
  };
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
 * { base, who } when this request's lists use the direct address: an https
 * direct address is set, routesDirect says yes (https, and from KR when
 * Cloudflare says where), the client declared the feature, it signed in and a
 * token can be made. null otherwise, and everything stays as it was.
 */
export function forRequest(req) {
  const base = env.publicDirectBaseUrl;
  if (!base || !base.startsWith("https://") || !wantsDirect(req) || !routesDirect(routeInputs(req))) return null;
  // Clients send every download to the direct address once they are given it, with no
  // fallback (its traffic may be metered elsewhere), so it is not given while it is down.
  if (knownDown()) return null;
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

// The lists and info a token rides on; never artwork or file downloads, whose
// responses may be cached. Matched on the path as the app sees it.
const TOKEN_PATHS = [
  /^\/(shop\.json|shop\.tfl)?$/i,
  /^\/api\/(shop|remote)\/(sections|info)$/,
  /^\/api\/title\/[^/]+(\/extras)?$/,
  /^\/api\/(homebrew|patches|saves)\/?$/,
  /^\/api\/client\/latest$/,
  /^\/api\/retro\/(systems|home|games)\/?$/,
  /^\/api\/retro\/games\/[^/]+$/,
  /^\/api\/retro\/base-pack\/manifest$/,
];

/** Whether `p` is a list or info response the token may ride on. Pure. */
export const carriesToken = (p) => TOKEN_PATHS.some((re) => re.test(p));

/** `value` with `private` in it (in place of `public`); "private, no-cache" when there is none. Pure. */
export function privateCacheControl(value) {
  const parts = String(value ?? "").split(",").map((d) => d.trim()).filter((d) => d && d.toLowerCase() !== "public");
  if (!parts.length) return "private, no-cache";
  return parts.some((d) => d.toLowerCase() === "private") ? parts.join(", ") : ["private", ...parts].join(", ");
}

/** Runs `fn` just before the response's headers go out, after the route has set its own. */
function beforeHeaders(res, fn) {
  const writeHead = res.writeHead;
  res.writeHead = function patched(...args) {
    res.writeHead = writeHead;
    fn();
    return writeHead.apply(this, args);
  };
}

/**
 * On the lists and info (carriesToken): while a direct address is set the body
 * depends on the feature header and the client's country, so the response says Vary on them; a signed-in
 * client that asked for direct-token also gets its token, and that response is
 * made private whatever the route set.
 */
export function tokenHeader() {
  return (req, res, next) => {
    if (!env.publicDirectBaseUrl || !carriesToken(req.path)) return next();
    const link = forRequest(req);
    const token = link ? tokens.issue(link.who) : null;
    beforeHeaders(res, () => {
      res.vary(FEATURES_HEADER);
      res.vary("CF-IPCountry");
      if (!token) return;
      res.setHeader(TOKEN_HEADER, token);
      res.setHeader(ORIGIN_HEADER, new URL(link.base).origin);
      res.setHeader("Cache-Control", privateCacheControl(res.getHeader("Cache-Control")));
    });
    next();
  };
}
