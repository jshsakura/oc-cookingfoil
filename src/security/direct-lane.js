/**
 * The signed lane: direct links (download-links.js) answered on the home network.
 *
 * A request takes this lane only when all of these hold; anything else goes
 * on through the normal stack and its sign-in, untouched:
 *   - direct links are on (server-settings directBaseUrl),
 *   - it carries exp and sig,
 *   - it is a direct LAN connection (no CF-Connecting-IP, from a private or
 *     loopback address): a signed request through the tunnel is not taken,
 *   - it is a GET or HEAD for a download: a file in the games folder (a game,
 *     update, DLC or a title's extra file) or one of DOWNLOAD_ROUTES.
 * On the lane the signature stands in for the sign-in. The request is answered
 * by the very routers the shop uses (`routes`) and by the games folder, and
 * never reaches pages, lists, the admin API, uploads, sign-in or any write.
 *
 * Refusals are 403 with X-CookingFoil-Link, so a client knows what to do:
 *   expired  the link ran out: read the list again
 *   used     the file was already delivered in full through this link: read the list again
 *   revoked  the account or console it was made for may no longer sign in
 *   invalid  not a link this server made
 *   blocked  this address sent too many invalid links (download-ban.js) and is shut out for a while
 * The client may then fall back to the item's `url`.
 */
import express from "express";
import * as links from "./download-links.js";
import * as state from "./download-state.js";
import { stillAllowed } from "./link-identity.js";
import { isDirectLan } from "./home-network.js";
import { createBan, BAD_WINDOW_MS, BAN_MS } from "./download-ban.js";
import { createCoverage, deliveredBytes } from "./link-coverage.js";
import { clientIp } from "./deny.js";
import { isLoopbackIp } from "./net.js";
import { trustLoopback } from "./limits.js";
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
    const delivered = deliveredBytes(req.method, res.statusCode, res.getHeader("content-range"));
    if (coverage.add(link.sig, link.exp, delivered)) state.markUsed(link.sig, link.exp, link.u);
  });
}

function newBan() {
  return createBan({
    onBan: (ip, count) => debug.error("direct lane: %s sent %d invalid links within %d minutes; blocked for %d minutes", ip, count, BAD_WINDOW_MS / 60000, BAN_MS / 60000),
  });
}

/** Whether this request is one for the signed lane at all (see the list above). */
function takesLane(req) {
  if (!env.directBaseUrl || (req.method !== "GET" && req.method !== "HEAD")) return false;
  return links.hasSignature(rawQuery(req.url)) && isDirectLan(req) && laneOf(req.path) !== null;
}

/**
 * `root` is the games folder; `routes` maps a mount prefix to its router
 * ({ "/api/retro": retroRouter, … }), the same instances the shop mounts.
 */
export default function directLane(root, { routes = {}, ban = newBan(), coverage = createCoverage() } = {}) {
  const lane = laneRouter(root, routes);
  return (req, res, next) => {
    if (!takesLane(req)) return next();

    res.set("Cache-Control", "private, no-store");
    const ip = clientIp(req);
    const exempt = trustLoopback && isLoopbackIp(ip);
    if (!exempt && ban.isBanned(ip)) return refuse(res, "blocked");

    const link = links.verifyRequest(req.path, rawQuery(req.url));
    if (link.verdict === "bad") {
      if (!exempt) ban.recordBad(ip);
      return refuse(res, "invalid");
    }
    if (link.verdict === "expired") return refuse(res, "expired");
    if (!link.u || !stillAllowed(state.identity(link.u))) return refuse(res, "revoked");
    if (state.isUsed(link.sig)) return refuse(res, "used");

    trackDelivery(req, res, link, coverage);
    lane(req, res, () => res.headersSent || res.status(404).end());
  };
}
