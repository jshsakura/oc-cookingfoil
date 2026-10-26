/**
 * Realtime push channel for the dashboard.
 *
 * Endpoint: `/ws/library`
 *
 * Wire protocol (text frames, JSON):
 *   server → client
 *     { type: "hello",        version, etag, files, customs, restarting }
 *     { type: "shop-updated", etag, files, customs, mode, buildMs }
 *     { type: "restarting", restart_id, retry_after, back_by, message }   // safe restart began
 *     { type: "activity", running: [...], recent: [...] }   // read-only task status
 *     { type: "ping" }                                    // hb keepalive
 *   client → server
 *     { type: "pong" }                                    // optional ack
 *
 * Endpoint: `/admin/ws` (the admin page; under /admin so its 2FA cookie rides along)
 *   server → client
 *     { type: "activity", running: [...], recent: [...] }   // on connect, then after each change
 *     { type: "ping" }
 *   Only this site's own page (an Origin is required), signed in as an admin
 *   account and past the admin's second step. No Basic: scripts poll the API.
 *
 * The page typically just listens for `shop-updated` and re-fetches
 * /api/library/sections (the etag short-circuits to 304 when the body hasn't
 * really changed, so this stays cheap). We never push the body itself.
 *
 * Auth reuses the web sign-in: a page's session cookie, only from this site's
 * own Origin. No password is taken here. Before that check an upgrade must
 * pass the address lockout, a small per-address limit (429 + Retry-After) and,
 * when it sends an Origin, a same-host check (403). Connections that fail are
 * dropped before the upgrade completes, with no separate token surface to manage.
 */
import { WebSocketServer } from "ws";
import * as shopCache from "../meta/shop-cache.js";
import * as securityStore from "../security/store.js";
import * as users from "../security/users.js";
import { webUser } from "../security/user-session.js";
import { sameHost } from "../security/same-origin.js";
import { trustedHere } from "../security/net.js";
import { clientAddress } from "../helpers/trust-proxy.js";
import pkg from "../app-info.js";
import debug from "../debug.js";
import drainer from "../security/drain.js";
import { hasValidSession } from "../security/admin-session.js";
import { mayAdminister } from "../security/admin-actor.js";
import * as activity from "../tasks/activity.js";
import { recordDeny, DENY } from "../security/deny.js";

const HEARTBEAT_MS = 30_000;
// Upgrades per address per window, checked before any credential: a page
// reconnects with a backoff of a second or more, so this only stops floods.
const UPGRADE_LIMIT = 10;
const UPGRADE_WINDOW_MS = 10_000;
const UPGRADE_TRACKED_MAX = 5000;

// The address the HTTP side would see as req.ip (X-Forwarded-For only through
// a trusted proxy), so the lockout and the limit key on the same client.
function clientIp(req) {
  return clientAddress(req);
}


const upgrades = new Map(); // ip → { count, resetAt }

/**
 * Count one upgrade for `ip`; the seconds to wait when it is over the limit,
 * else 0. Fixed window, bounded map (the oldest address is dropped first).
 */
export function upgradeWait(ip, now = Date.now()) {
  let entry = upgrades.get(ip);
  if (!entry || now >= entry.resetAt) {
    upgrades.delete(ip);
    entry = { count: 0, resetAt: now + UPGRADE_WINDOW_MS };
    upgrades.set(ip, entry);
    if (upgrades.size > UPGRADE_TRACKED_MAX) upgrades.delete(upgrades.keys().next().value);
  }
  entry.count += 1;
  return entry.count > UPGRADE_LIMIT ? Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) : 0;
}

/** Test-only. */
export function resetUpgradeLimitForTests() {
  upgrades.clear();
}

/** Whether the upgrade may connect: "ok", or "denied" when it is not a signed-in page of this site. */
export function authorize(req) {
  if (!users.hasUsers()) return "ok"; // no accounts → no sign-in wall
  // A browser signed in at /login (password or Google) carries its session
  // cookie; only this site's own pages may use it.
  return sameHost(req) === true && webUser(req) ? "ok" : "denied";
}

export const ADMIN_PATH = "/admin/ws";

/** The admin channel: the admin page's own Origin, an admin account, and the 2FA session. */
export function authorizeAdmin(req) {
  if (sameHost(req) !== true) return false;
  req.webUser = webUser(req);
  return mayAdminister(req) && hasValidSession(req);
}

function refuse(socket, statusLine, extra = "") {
  socket.write(`HTTP/1.1 ${statusLine}\r\n${extra}\r\n`);
  socket.destroy();
}

function send(ws, obj) {
  if (ws.readyState !== 1) return; // OPEN
  try { ws.send(JSON.stringify(obj)); } catch (err) {
    debug.error("ws: send failed: %s", err.message);
  }
}

export function attach(server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });

  const adminWss = new WebSocketServer({ noServer: true, maxPayload: 1024 });

  server.on("upgrade", (req, socket, head) => {
    // Known paths only — anything else gets 404'd here, not silently dropped,
    // so misconfigured clients see the failure.
    if (req.url === ADMIN_PATH) return upgradeAdmin(req, socket, head);
    if (req.url !== "/ws/library") {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return;
    }
    const ip = clientIp(req);
    const trusted = trustedHere(req);
    if (!trusted && securityStore.isLocked(ip)) return refuse(socket, "403 Forbidden");
    // Before any credential check: a flood of upgrades costs a map lookup each.
    const wait = upgradeWait(ip);
    if (wait) return refuse(socket, "429 Too Many Requests", `Retry-After: ${wait}\r\n`);
    // Browsers always send Origin on an upgrade: another site's page is refused outright.
    if (sameHost(req) === false) return refuse(socket, "403 Forbidden");
    let verdict = "denied";
    try { verdict = authorize(req); } catch (err) { debug.error("ws: auth check failed: %s", err.message); }
    // No Basic challenge: nothing here takes a password.
    if (verdict !== "ok") return refuse(socket, "401 Unauthorized");
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  function upgradeAdmin(req, socket, head) {
    const ip = clientIp(req);
    if (!trustedHere(req) && securityStore.isLocked(ip)) return refuse(socket, "403 Forbidden");
    const wait = upgradeWait(ip);
    if (wait) return refuse(socket, "429 Too Many Requests", `Retry-After: ${wait}\r\n`);
    if (sameHost(req) !== true) return refuse(socket, "403 Forbidden");
    let ok = false;
    try { ok = authorizeAdmin(req); } catch (err) { debug.error("ws: admin auth check failed: %s", err.message); }
    if (!ok) {
      // The same record the HTTP gate leaves, with the address it would see.
      recordDeny({ ip, method: "GET", originalUrl: ADMIN_PATH, get: (name) => req.headers[String(name).toLowerCase()] }, { reason: DENY.ADMIN_NO_SESSION, status: 401 });
      return refuse(socket, "401 Unauthorized");
    }
    adminWss.handleUpgrade(req, socket, head, (ws) => adminWss.emit("connection", ws, req));
  }

  adminWss.on("connection", (ws, req) => {
    ws.isAlive = true;
    // Checked again on every heartbeat: a demoted account or an expired 2FA session stops receiving.
    ws.stillAllowed = () => { try { return authorizeAdmin(req); } catch { return false; } };
    send(ws, { type: "activity", ...activity.list() });
    const off = activity.subscribe((snap) => send(ws, { type: "activity", ...snap }));
    ws.on("pong", () => { ws.isAlive = true; });
    ws.on("message", () => {});
    ws.on("close", off);
    ws.on("error", (err) => debug.error("ws: admin client error: %s", err.message));
  });

  wss.on("connection", (ws, req) => {
    const ip = clientIp(req);
    ws.isAlive = true;
    debug.log("ws: connect %s (clients=%d)", ip, wss.clients.size + 1);

    // Snapshot greeting so the client can fast-path re-render without
    // waiting for the next debounced rebuild.
    const stats = shopCache.stats();
    send(ws, {
      type: "hello",
      version: pkg.version,
      etag: null, // not exposed via stats() — clients will get it on next update
      files: stats.files,
      customs: 0, // exposed in updates, kept opaque here
      // The drain's notice while the server is restarting, else null: a page that
      // reconnects mid-drain keeps its notice, one that reconnects after drops it.
      restarting: drainer.notice(),
    });
    // Read-only activity shares the shop's existing browser channel.
    send(ws, { type: "activity", ...activity.list() });
    const offActivity = activity.subscribe((snap) => send(ws, { type: "activity", ...snap }));
    ws.on("close", offActivity);

    ws.on("pong", () => { ws.isAlive = true; });
    ws.on("message", (raw) => {
      // We don't accept commands from clients yet. Decode + ignore so a
      // chatty client doesn't slowly leak Buffers.
      try { JSON.parse(raw.toString("utf-8")); } catch { /* ignore */ }
    });
    ws.on("close", () => {
      debug.log("ws: disconnect %s (clients=%d)", ip, wss.clients.size - 1);
    });
    ws.on("error", (err) => debug.error("ws: client error %s: %s", ip, err.message));
  });

  // Heartbeat: ping every interval, terminate clients that haven't
  // responded to the previous ping. Avoids piling up half-closed sockets
  // behind NAT routers / sleeping laptops.
  const hbTimer = setInterval(() => {
    for (const ws of [...wss.clients, ...adminWss.clients]) {
      if (ws.isAlive === false || (ws.stillAllowed && !ws.stillAllowed())) {
        debug.log("ws: terminating unresponsive client");
        try { ws.terminate(); } catch {}
        continue;
      }
      ws.isAlive = false;
      try { ws.ping(); } catch {}
    }
  }, HEARTBEAT_MS);
  if (hbTimer.unref) hbTimer.unref();

  // Fan shop-cache updates out to every connected client. Cheap — payload
  // is a small JSON, and we already do the heavy work (build, encode) in
  // shop-cache itself.
  const unsubscribe = shopCache.onUpdate((payload) => {
    const msg = JSON.stringify({ type: "shop-updated", ...payload });
    for (const ws of wss.clients) {
      if (ws.readyState !== 1) continue;
      try { ws.send(msg); } catch (err) {
        debug.error("ws: broadcast failed: %s", err.message);
      }
    }
  });

  return {
    /** Sends one message to every open dashboard. */
    broadcast(obj) {
      const msg = JSON.stringify(obj);
      for (const ws of wss.clients) {
        if (ws.readyState !== 1) continue;
        try { ws.send(msg); } catch (err) { debug.error("ws: broadcast failed: %s", err.message); }
      }
    },
    close() {
      clearInterval(hbTimer);
      unsubscribe();
      for (const ws of [...wss.clients, ...adminWss.clients]) { try { ws.terminate(); } catch {} }
      wss.close();
      adminWss.close();
    },
    clients: () => wss.clients.size,
  };
}
