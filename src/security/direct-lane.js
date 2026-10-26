/**
 * The token lane: downloads on the direct address, answered without the sign-in.
 *
 * The direct address (publicDirectBaseUrl) is a proxy on this host that
 * forwards only GET/HEAD requests carrying `Authorization: Bearer …`, sets
 * X-Forwarded-For itself and fixes Host to that address. A request is the
 * proxy's only when all of these hold; anything else goes on through the
 * normal stack and its sign-in, untouched:
 *   - a direct address is set,
 *   - the socket peer is this machine (loopback or the container's gateway,
 *     local-hop.js): only the proxy on the host connects from there,
 *   - Host, and X-Forwarded-Host when present, is the direct address's host,
 *   - it did not come through the Cloudflare tunnel (no CF-Connecting-IP),
 *   - it carries X-CookingFoil-Edge with the shared secret COOK_DIRECT_EDGE_SECRET
 *     (compose only), so another container behind the same gateway can't pose
 *     as the proxy. Without the secret configured the direct address serves
 *     nothing (one warning in the log).
 * Every request that looks like the proxy's (the first four) is answered here:
 * without the right edge secret it is a 404. A request from this machine, not
 * through the tunnel, with the right edge secret is the proxy's even when the direct address was since
 * cleared or changed: it is answered 401 revoked, so the client reads its lists
 * again (and gets today's URLs), rather than falling through to the other lanes. The edge header is removed before
 * a request reaches the download routers. Only a GET or HEAD for a
 * download is served: a file in the games folder (a game, update, DLC or a
 * title's extra file) or one of DOWNLOAD_ROUTES; anything else is a 404, so
 * the direct address carries nothing but downloads. Passwords, device keys
 * and sessions count for nothing here: only the download token does.
 *
 * The client is the rightmost X-Forwarded-For entry, the one the proxy wrote;
 * whatever a client sends to the left of it is ignored. That address is what
 * the ban (download-ban.js) counts and what the log names. The ban is a short
 * first line: the proxy logs every refusal, and a firewall rule built on those
 * logs (CrowdSec) is the hard ban.
 *
 * The request is answered by the very routers the library uses (`routes`) and by
 * the games folder with the same options as the library's own static handler, so
 * ETag, Last-Modified, Range and If-Range behave the same on both lanes and a
 * resume may switch between them. It never reaches pages, lists, the admin
 * API, uploads, sign-in or any write.
 *
 * Refusals carry X-CookingFoil-Token, so a client knows what to do:
 *   401 invalid  no token, or not one this server made
 *   401 expired  the token ran out, or was signed with a key since replaced:
 *                read any list again for the current one (a token that ran out never
 *                counts toward the ban; one whose MAC fails does, at STALE_BAN_LIMIT)
 *   401 revoked  the account or console it was made for may no longer sign in
 *   403 blocked  this address sent too many invalid tokens and is shut out for a while
 */
import crypto from "crypto";
import express from "express";
import net from "net";
import * as tokens from "./download-token.js";
import { vouch } from "./server-id.js";
import { stillAllowed } from "./link-identity.js";
import { createBan, BAD_WINDOW_MS, BAN_MS } from "./download-ban.js";
import { isLocalHop } from "./local-hop.js";
import connectionHint from "../helpers/connection-hint.js";
import { largeFiles, hasHiddenSegment, GAME_FILE_RE } from "../helpers/file-send.js";
import { trackTransfers } from "../helpers/transfer-track.js";
import * as env from "../helpers/envs.js";
import debug from "../debug.js";

export const TOKEN_STATE_HEADER = "X-CookingFoil-Token";
export const EDGE_HEADER = "X-CookingFoil-Edge";

// The downloads the lane serves besides games-folder files. Matched on the raw path, case and all.
const DOWNLOAD_ROUTES = [
  /^\/api\/retro\/games\/[^/]+\/(rom|bundle|bezel\.png|overlay\.cfg|game\.cfg)$/,
  /^\/api\/retro\/base-pack(\/bundle)?$/,
  /^\/api\/retro\/base-pack\/file\/.+$/,
  /^\/api\/patches\/[^/]+\/download$/,
  /^\/api\/homebrew\/[^/]+\/(download|file|archive|bundle)$/,
  /^\/api\/saves\/[^/]+\/download$/,
  /^\/api\/client\/cookingfoil\.nro$/,
];

// Paths the library itself answers at the root; never served from the games folder here.
const CATALOG_PATHS = new Set(["/games.json", "/shop.json", "/robots.txt", "/healthz"]);

/** "route" for a download route, "file" for a path in the games folder, null for anything else. Pure. */
export function laneOf(rawPath) {
  if (DOWNLOAD_ROUTES.some((re) => re.test(rawPath))) return "route";
  if (rawPath.endsWith("/") || CATALOG_PATHS.has(rawPath.toLowerCase())) return null;
  if (/^\/(api|admin|assets|pair|login|logout|setup)(\/|$)/i.test(rawPath)) return null;
  return "file";
}

const peerOf = (req) => String(req.socket?.remoteAddress ?? "").replace(/^::ffff:/, "");

function directHost() {
  if (!env.publicDirectBaseUrl) return "";
  try {
    return new URL(env.publicDirectBaseUrl).host.toLowerCase();
  } catch {
    return "";
  }
}

const headerHost = (req, name) => String(req.get(name) ?? "").trim().toLowerCase();

/** The rightmost X-Forwarded-For entry (the one the proxy wrote), or null. Pure. */
export function proxiedClient(xff) {
  const last = String(xff ?? "").split(",").pop().trim().replace(/^::ffff:/, "");
  return net.isIP(last) ? last : null;
}

/** Whether a request is addressed like the proxy's: peer, Host and no tunnel (the first four above). */
export function looksProxied(req) {
  const host = directHost();
  if (!host || req.get("cf-connecting-ip") || !isLocalHop(peerOf(req))) return false;
  if (headerHost(req, "host") !== host) return false;
  return req.get("x-forwarded-host") === undefined || headerHost(req, "x-forwarded-host") === host;
}

/** Whether `sent` is the edge secret; an empty secret matches nothing. Timing-safe. */
export function edgeMatches(sent, secret) {
  if (!secret || typeof sent !== "string") return false;
  const a = crypto.createHash("sha256").update(sent).digest();
  const b = crypto.createHash("sha256").update(secret).digest();
  return crypto.timingSafeEqual(a, b);
}

/**
 * The client's address when a request came from the direct address's proxy
 * (see the list above), else null. Only then is X-Forwarded-For trusted.
 */
export function viaDirectProxy(req, secret = env.directEdgeSecret) {
  if (!looksProxied(req) || !edgeMatches(req.get(EDGE_HEADER), secret)) return null;
  return proxiedClient(req.get("x-forwarded-for"));
}

let warnedNoSecret = false;

/** The token of an `Authorization: Bearer <token>` header, or null for anything else. Pure. */
export function bearerToken(header) {
  const m = /^Bearer[ ]+([^\s]+)[ ]*$/i.exec(String(header ?? ""));
  return m ? m[1] : null;
}

function refuse(res, status, verdict) {
  res.set(TOKEN_STATE_HEADER, verdict);
  if (status === 401) res.set("WWW-Authenticate", `Bearer error="invalid_token"`);
  return res.status(status).type("text/plain").send(`token ${verdict}`);
}

/** The routes and files the lane may reach, and nothing else. */
function laneRouter(root, routes) {
  const router = express.Router();
  // Everything that gets this far is a download: the records see it with route "direct".
  router.use(trackTransfers());
  router.use(connectionHint());
  for (const [prefix, route] of Object.entries(routes)) router.use(prefix, route);
  const serve = express.static(root, { index: false, redirect: false, fallthrough: false, dotfiles: "ignore" });
  const large = largeFiles(root, GAME_FILE_RE);
  // Nothing inside a dot-folder (the NSZ work folder), "%2e" or not: the library's own handlers refuse it too.
  router.use((req, res, next) => {
    if (laneOf(req.path) !== "file") return next();
    if (hasHiddenSegment(req.path)) return res.status(404).end();
    // An error from the game-file handler (a variant that failed to read) is passed on, never served around.
    large(req, res, (err) => (err ? next(err) : serve(req, res, next)));
  });
  router.use((req, res) => res.status(404).end());
  router.use((err, req, res, _next) => {
    if (res.headersSent) return;
    const status = err?.status ?? err?.statusCode ?? 500;
    if (status >= 500) debug.error("direct lane: %s failed: %s", req.path, err?.message ?? err);
    res.status(status).end();
  });
  return router;
}

// Tokens shaped like ours whose MAC fails ("stale"): what a console holds after the key was
// replaced, so they are told to read their lists again, and only this many in the window ban.
// A console that keeps its old token goes back to its lists after one 401; a guesser that
// copies our shape does not.
export const STALE_BAN_LIMIT = 50;

function newBan({ limit, what = "invalid" } = {}) {
  return createBan({
    ...(limit ? { limit } : {}),
    onBan: (ip, count) => debug.error("direct lane: %s sent %d %s tokens within %d minutes; blocked for %d minutes", ip, count, what, BAD_WINDOW_MS / 60000, BAN_MS / 60000),
  });
}

const isDownload = (req) => (req.method === "GET" || req.method === "HEAD") && laneOf(req.path) !== null;

/**
 * `root` is the games folder; `routes` maps a mount prefix to its router
 * ({ "/api/retro": retroRouter, … }), the same instances the library mounts.
 */
export default function directLane(root, { routes = {}, ban = newBan(), staleBan = newBan({ limit: STALE_BAN_LIMIT, what: "stale" }), edgeSecret = env.directEdgeSecret } = {}) {
  const lane = laneRouter(root, routes);
  return (req, res, next) => {
    if (!looksProxied(req)) {
      const fromProxy = !req.get("cf-connecting-ip") && isLocalHop(peerOf(req)) && edgeMatches(req.get(EDGE_HEADER), edgeSecret);
      delete req.headers[EDGE_HEADER.toLowerCase()];
      if (fromProxy) return refuse(res.set("Cache-Control", "no-store"), 401, "revoked");
      return next();
    }
    if (!edgeSecret && !warnedNoSecret) {
      warnedNoSecret = true;
      debug.error("direct lane: COOK_DIRECT_EDGE_SECRET is not set, so the direct address %s serves nothing", env.publicDirectBaseUrl);
    }
    const ip = viaDirectProxy(req, edgeSecret);
    delete req.headers[EDGE_HEADER.toLowerCase()];
    if (!ip) return res.set("Cache-Control", "no-store").status(404).end();
    // The direct address answers downloads and nothing else.
    if (!isDownload(req)) return res.set("Cache-Control", "no-store").status(404).end();

    res.set("Cache-Control", "private, no-store");
    if (ban.isBanned(ip) || staleBan.isBanned(ip)) return refuse(res, 403, "blocked");

    const token = tokens.verify(bearerToken(req.get("authorization")));
    if (token.verdict === "invalid") {
      ban.recordBad(ip);
      return refuse(res, 401, "invalid");
    }
    if (token.verdict === "stale") {
      staleBan.recordBad(ip);
      return refuse(res, 401, "expired");
    }
    // From here the token's MAC checked out: it is ours, so the answer names the server (server-id.js).
    vouch(res);
    if (token.verdict === "expired") return refuse(res, 401, "expired");
    if (!stillAllowed(token.sub)) return refuse(res, 401, "revoked");

    // The download records (transfer-track.js): this lane, for whom, and the client the proxy named.
    req.cookingfoilLane = "direct";
    req.directSub = token.sub;
    req.directClient = ip;
    lane(req, res, () => res.headersSent || res.status(404).end());
  };
}
