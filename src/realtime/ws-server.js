/**
 * Realtime push channel for the dashboard.
 *
 * Endpoint: `/ws/library`
 *
 * Wire protocol (text frames, JSON):
 *   server → client
 *     { type: "hello",        version, etag, files, customs, titledbSize, restarting }
 *     { type: "shop-updated", etag, files, customs, titledbSize, mode, buildMs }
 *     { type: "restarting", restart_id, retry_after, back_by, message }   // safe restart began
 *     { type: "ping" }                                    // hb keepalive
 *   client → server
 *     { type: "pong" }                                    // optional ack
 *
 * The client typically just listens for `shop-updated` and re-fetches
 * /shop.json (the etag short-circuits to 304 when the body hasn't really
 * changed, so this stays cheap). We never push the body itself —
 * /shop.json is already a Buffer write away.
 *
 * Auth reuses the server's sign-in: a page's session cookie (only from this
 * site's own Origin) or Basic credentials, checked with the same async scrypt
 * as the HTTP lane. Before any credential check an upgrade must pass the
 * address lockout, a small per-address limit (429 + Retry-After) and, when it
 * sends an Origin, a same-host check (403). Wrong passwords count toward the
 * HTTP lockout. Connections that fail are dropped before the upgrade
 * completes — no separate token surface to manage.
 */
import { WebSocketServer } from "ws";
import * as shopCache from "../meta/shop-cache.js";
import * as securityStore from "../security/store.js";
import * as users from "../security/users.js";
import { webUser } from "../security/user-session.js";
import { sameHost } from "../security/same-origin.js";
import { recordFailure, repeatedPoll } from "../security/auth-guard.js";
import { isLoopbackSocket } from "../security/net.js";
import { trustLoopback } from "../security/limits.js";
import { clientAddress } from "../helpers/trust-proxy.js";
import pkg from "../package.js";
import debug from "../debug.js";
import drainer from "../security/drain.js";

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

// Same as auth-guard: the socket decides, a forwarded 127.0.0.1 is only a header.
const isLoopback = (req) => trustLoopback && isLoopbackSocket(req);

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

function decodeBasicAuth(authHeader) {
  if (!authHeader || !authHeader.startsWith("Basic ")) return null;
  try {
    const decoded = Buffer.from(authHeader.slice(6), "base64").toString("utf-8");
    const idx = decoded.indexOf(":");
    if (idx < 0) return null;
    return { user: decoded.slice(0, idx), pass: decoded.slice(idx + 1) };
  } catch {
    return null;
  }
}

/**
 * Whether the upgrade may connect: "ok", "denied" (no usable credentials), or
 * "bad-credentials" (a password was tried and was wrong, which counts toward
 * the lockout). The password check is the async scrypt the HTTP lane uses, so
 * a flood of upgrades never blocks the event loop.
 */
export async function authorize(req) {
  if (!users.hasUsers()) return "ok"; // no accounts → password lane is off
  // A browser signed in at /login (password or Google) carries its session
  // cookie; only this site's own pages may use it.
  if (!req.headers["authorization"] && sameHost(req) === true && webUser(req)) return "ok";
  const creds = decodeBasicAuth(req.headers["authorization"]);
  if (!creds) return "denied";
  return (await users.verifyAsync(creds.user, creds.pass)) ? "ok" : "bad-credentials";
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
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    // Single path — anything else gets 404'd here, not silently dropped,
    // so misconfigured clients see the failure.
    if (req.url !== "/ws/library") {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return;
    }
    const ip = clientIp(req);
    const trusted = isLoopback(req);
    if (!trusted && securityStore.isLocked(ip)) return refuse(socket, "403 Forbidden");
    // Before any credential check: a flood of upgrades costs a map lookup each.
    const wait = upgradeWait(ip);
    if (wait) return refuse(socket, "429 Too Many Requests", `Retry-After: ${wait}\r\n`);
    // Browsers always send Origin on an upgrade: another site's page is refused
    // outright. A non-browser client sends none and is judged by Basic alone.
    if (sameHost(req) === false) return refuse(socket, "403 Forbidden");
    authorize(req).then((verdict) => {
      if (socket.destroyed) return;
      if (verdict !== "ok") {
        // A wrong password counts toward the same lockout as the HTTP lane;
        // the same wrong credentials from one address count once a window,
        // so a page reconnecting with stale ones cannot lock its owner out.
        if (verdict === "bad-credentials" && !trusted && !repeatedPoll(ip, req.headers.authorization)) {
          recordFailure(ip, { path: "/ws/library", get: (name) => req.headers[String(name).toLowerCase()] });
        }
        // Mirror the HTTP basic-auth posture: a 401 with WWW-Authenticate
        // so a non-browser client knows to send credentials. A page's socket
        // (it sends Origin) gets no challenge: Safari would otherwise open
        // the Basic popup over the page, as auth-guard avoids.
        return refuse(socket, "401 Unauthorized", req.headers.origin ? "" : 'WWW-Authenticate: Basic realm="CookingFoil"\r\n');
      }
      if (req.headers["authorization"] && !trusted) securityStore.clearFailure(ip);
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
    }, (err) => {
      debug.error("ws: auth check failed: %s", err.message);
      if (!socket.destroyed) refuse(socket, "500 Internal Server Error");
    });
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
      titledbSize: stats.titledbSize,
      // The drain's notice while the server is restarting, else null: a page that
      // reconnects mid-drain keeps its notice, one that reconnects after drops it.
      restarting: drainer.notice(),
    });

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
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
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
      for (const ws of wss.clients) { try { ws.terminate(); } catch {} }
      wss.close();
    },
    clients: () => wss.clients.size,
  };
}
