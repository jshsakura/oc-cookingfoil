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
 *   - it did not come through the Cloudflare tunnel (no CF-Connecting-IP).
 * Every request of the proxy is answered here. Only a GET or HEAD for a
 * download is served: a file in the games folder (a game, update, DLC or a
 * title's extra file) or one of DOWNLOAD_ROUTES; anything else is a 404, so
 * the direct address carries nothing but downloads. Basic auth, device keys
 * and sessions count for nothing here: only the download token does.
 *
 * The client is the rightmost X-Forwarded-For entry, the one the proxy wrote;
 * whatever a client sends to the left of it is ignored. That address is what
 * the ban (download-ban.js) counts and what the log names. The ban is a short
 * first line: the proxy logs every refusal, and a firewall rule built on those
 * logs (CrowdSec) is the hard ban.
 *
 * The request is answered by the very routers the shop uses (`routes`) and by
 * the games folder with the same options as the shop's own static handler, so
 * ETag, Last-Modified, Range and If-Range behave the same on both lanes and a
 * resume may switch between them. It never reaches pages, lists, the admin
 * API, uploads, sign-in or any write.
 *
 * Refusals carry X-CookingFoil-Token, so a client knows what to do:
 *   401 invalid  no token, or not one this server made
 *   401 expired  the token ran out: read any list again for the current one
 *   401 revoked  the account or console it was made for may no longer sign in
 *   403 blocked  this address sent too many invalid tokens and is shut out for a while
 */
import express from "express";
import net from "net";
import * as tokens from "./download-token.js";
import { stillAllowed } from "./link-identity.js";
import { createBan, BAD_WINDOW_MS, BAN_MS } from "./download-ban.js";
import { isLocalHop } from "./local-hop.js";
import connectionHint from "../helpers/connection-hint.js";
import * as env from "../helpers/envs.js";
import debug from "../debug.js";

export const TOKEN_STATE_HEADER = "X-CookingFoil-Token";

// The downloads the lane serves besides games-folder files. Matched on the raw path, case and all.
const DOWNLOAD_ROUTES = [
  /^\/api\/retro\/games\/[^/]+\/(rom|bundle|bezel\.png|overlay\.cfg|game\.cfg|forwarder\.nsp)$/,
  /^\/api\/retro\/base-pack(\/bundle)?$/,
  /^\/api\/retro\/base-pack\/file\/.+$/,
  /^\/api\/patches\/[^/]+\/download$/,
  /^\/api\/homebrew\/[^/]+\/(download|file|archive|bundle|forwarder)$/,
  /^\/api\/saves\/[^/]+\/download$/,
  /^\/api\/client\/(cookingfoil\.nro|forwarder)$/,
];

// Paths the shop itself answers at the root; never served from the games folder here.
const SHOP_PATHS = new Set(["/shop.json", "/shop.tfl", "/robots.txt", "/healthz"]);

/** "route" for a download route, "file" for a path in the games folder, null for anything else. Pure. */
export function laneOf(rawPath) {
  if (DOWNLOAD_ROUTES.some((re) => re.test(rawPath))) return "route";
  if (rawPath.endsWith("/") || SHOP_PATHS.has(rawPath.toLowerCase())) return null;
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

/**
 * The client's address when a request came from the direct address's proxy
 * (see the list above), else null.
 */
export function viaDirectProxy(req) {
  const host = directHost();
  if (!host || req.get("cf-connecting-ip") || !isLocalHop(peerOf(req))) return null;
  if (headerHost(req, "host") !== host) return null;
  if (req.get("x-forwarded-host") !== undefined && headerHost(req, "x-forwarded-host") !== host) return null;
  return proxiedClient(req.get("x-forwarded-for"));
}

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
  router.use(connectionHint());
  for (const [prefix, route] of Object.entries(routes)) router.use(prefix, route);
  const serve = express.static(root, { index: false, redirect: false, fallthrough: false });
  router.use((req, res, next) => (laneOf(req.path) === "file" ? serve(req, res, next) : next()));
  router.use((req, res) => res.status(404).end());
  router.use((err, req, res, _next) => {
    if (res.headersSent) return;
    const status = err?.status ?? err?.statusCode ?? 500;
    if (status >= 500) debug.error("direct lane: %s failed: %s", req.path, err?.message ?? err);
    res.status(status).end();
  });
  return router;
}

function newBan() {
  return createBan({
    onBan: (ip, count) => debug.error("direct lane: %s sent %d invalid tokens within %d minutes; blocked for %d minutes", ip, count, BAD_WINDOW_MS / 60000, BAN_MS / 60000),
  });
}

const isDownload = (req) => (req.method === "GET" || req.method === "HEAD") && laneOf(req.path) !== null;

/**
 * `root` is the games folder; `routes` maps a mount prefix to its router
 * ({ "/api/retro": retroRouter, … }), the same instances the shop mounts.
 */
export default function directLane(root, { routes = {}, ban = newBan() } = {}) {
  const lane = laneRouter(root, routes);
  return (req, res, next) => {
    const ip = viaDirectProxy(req);
    if (!ip) return next();
    // The direct address answers downloads and nothing else.
    if (!isDownload(req)) return res.set("Cache-Control", "no-store").status(404).end();

    res.set("Cache-Control", "private, no-store");
    if (ban.isBanned(ip)) return refuse(res, 403, "blocked");

    const token = tokens.verify(bearerToken(req.get("authorization")));
    if (token.verdict === "invalid") {
      ban.recordBad(ip);
      return refuse(res, 401, "invalid");
    }
    if (token.verdict === "expired") return refuse(res, 401, "expired");
    if (!stillAllowed(token.sub)) return refuse(res, 401, "revoked");

    lane(req, res, () => res.headersSent || res.status(404).end());
  };
}
