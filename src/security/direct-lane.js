/**
 * The signed lane: direct links (download-links.js), answered without the sign-in.
 *
 * Direct links point at the direct address (publicDirectBaseUrl), a proxy on
 * this host that forwards only GET/HEAD requests carrying exp and sig, sets
 * X-Forwarded-For itself and fixes Host to that address. A request takes this
 * lane only when all of these hold; anything else goes on through the normal
 * stack and its sign-in, untouched:
 *   - a direct address is set,
 *   - the socket peer is this machine (loopback or the container's gateway,
 *     local-hop.js): only the proxy on the host connects from there,
 *   - Host, and X-Forwarded-Host when present, is the direct address's host,
 *   - it did not come through the Cloudflare tunnel (no CF-Connecting-IP),
 *   - it carries exp and sig and is a GET or HEAD for a download: a file in the
 *     games folder (a game, update, DLC or a title's extra file) or one of
 *     DOWNLOAD_ROUTES.
 * A request that came from the proxy but is not one of those is a 404, so the
 * direct address carries nothing but the files its links point to.
 *
 * The client is the rightmost X-Forwarded-For entry, the one the proxy wrote;
 * whatever a client sends to the left of it is ignored. That address is what
 * the ban (download-ban.js) counts and what the log names. The ban is a short
 * first line: the proxy logs every 403, and a firewall rule built on those
 * logs (CrowdSec) is the hard ban.
 *
 * On the lane the request is answered by the very routers the shop uses
 * (`routes`) and by the games folder with the same options as the shop's own
 * static handler, so ETag and Last-Modified match on both lanes and a resume
 * may switch between them. It never reaches pages, lists, the admin API,
 * uploads, sign-in or any write.
 *
 * Refusals are 403 with X-CookingFoil-Link, so a client knows what to do:
 *   expired  the link ran out: read the list again
 *   used     the file was already delivered in full through this link: read the list again
 *   revoked  the account or console it was made for may no longer sign in
 *   invalid  not a link this server made
 *   blocked  this address sent too many invalid links and is shut out for a while
 * The client may then fall back to the item's `url`.
 */
import express from "express";
import net from "net";
import * as links from "./download-links.js";
import * as state from "./download-state.js";
import { stillAllowed } from "./link-identity.js";
import { createBan, BAD_WINDOW_MS, BAN_MS } from "./download-ban.js";
import { createCoverage, deliveredBytes } from "./link-coverage.js";
import { isLocalHop } from "./local-hop.js";
import connectionHint from "../helpers/connection-hint.js";
import * as env from "../helpers/envs.js";
import debug from "../debug.js";

export const LINK_HEADER = "X-CookingFoil-Link";

// The downloads a link may open besides games-folder files. Matched on the raw path, case and all.
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

const rawQuery = (url) => (url.includes("?") ? url.slice(url.indexOf("?") + 1) : "");

function refuse(res, verdict) {
  res.set(LINK_HEADER, verdict);
  return res.status(403).type("text/plain").send(`link ${verdict}`);
}

/** The routes and files a verified link may reach, and nothing else. */
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

/** Closes the link once its file has been delivered in full (link-coverage.js). */
function trackDelivery(req, res, link, coverage) {
  if (req.method !== "GET") return;
  res.on("finish", () => {
    // Handed to the operating system on a socket that has not failed (see link-coverage.js).
    if (res.socket?.errored || req.socket?.errored) return;
    const delivered = deliveredBytes(req.method, res.statusCode, res.getHeader("content-range"));
    if (coverage.add(link.sig, link.exp, delivered)) state.markUsed(link.sig, link.exp, link.u);
  });
}

function newBan() {
  return createBan({
    onBan: (ip, count) => debug.error("direct lane: %s sent %d invalid links within %d minutes; blocked for %d minutes", ip, count, BAD_WINDOW_MS / 60000, BAN_MS / 60000),
  });
}

/** Whether a request from the proxy is one for the signed lane (see the list above). */
function takesLane(req) {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  return links.hasSignature(rawQuery(req.url)) && laneOf(req.path) !== null;
}

/**
 * `root` is the games folder; `routes` maps a mount prefix to its router
 * ({ "/api/retro": retroRouter, … }), the same instances the shop mounts.
 */
export default function directLane(root, { routes = {}, ban = newBan(), coverage = createCoverage() } = {}) {
  const lane = laneRouter(root, routes);
  return (req, res, next) => {
    const ip = viaDirectProxy(req);
    if (!ip) return next();
    // The direct address answers links and nothing else.
    if (!takesLane(req)) return res.set("Cache-Control", "no-store").status(404).end();

    res.set("Cache-Control", "private, no-store");
    if (ban.isBanned(ip)) return refuse(res, "blocked");

    const link = links.verifyRequest(req.path, rawQuery(req.url));
    if (link.verdict === "bad") {
      ban.recordBad(ip);
      return refuse(res, "invalid");
    }
    if (link.verdict === "expired") return refuse(res, "expired");
    if (!link.u || !stillAllowed(state.identity(link.u))) return refuse(res, "revoked");
    if (state.isUsed(link.sig)) return refuse(res, "used");

    trackDelivery(req, res, link, coverage);
    lane(req, res, () => res.headersSent || res.status(404).end());
  };
}
