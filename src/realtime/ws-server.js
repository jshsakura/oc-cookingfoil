/**
 * Realtime push channel for the dashboard.
 *
 * Endpoint: `/ws/library`
 *
 * Wire protocol (text frames, JSON):
 *   server → client
 *     { type: "hello",        version, etag, files, customs, titledbSize }
 *     { type: "shop-updated", etag, files, customs, titledbSize, mode, buildMs }
 *     { type: "ping" }                                    // hb keepalive
 *   client → server
 *     { type: "pong" }                                    // optional ack
 *
 * The client typically just listens for `shop-updated` and re-fetches
 * /shop.json (the etag short-circuits to 304 when the body hasn't really
 * changed, so this stays cheap). We never push the body itself —
 * /shop.json is already a Buffer write away.
 *
 * Auth reuses the server's basic-auth: WebSocket upgrade requests carry
 * the browser's stored credentials in the `Authorization` header just
 * like XHR does. Connections that fail the credential check are dropped
 * before the upgrade completes — no separate token surface to manage.
 */
import { WebSocketServer } from "ws";
import * as shopCache from "../meta/shop-cache.js";
import * as securityStore from "../security/store.js";
import { getUsersFromEnv } from "../authUsersParser.js";
import pkg from "../package.js";
import debug from "../debug.js";

const HEARTBEAT_MS = 30_000;

const userMap = getUsersFromEnv(); // { username: password } | null when auth disabled

function clientIp(req) {
  // express's req.ip honors trust-proxy; raw upgrade requests don't go
  // through express, so we hit the underlying socket directly. trust-proxy
  // for ws would need explicit X-Forwarded-For handling — defer until
  // someone actually puts CookingFoil behind a load balancer.
  return req.socket.remoteAddress || "unknown";
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

function isAuthorized(req) {
  if (!userMap) return true; // auth disabled globally
  const creds = decodeBasicAuth(req.headers["authorization"]);
  if (!creds) return false;
  const expected = userMap[creds.user];
  return typeof expected === "string" && expected === creds.pass;
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
    if (securityStore.isLocked(ip)) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    if (!isAuthorized(req)) {
      // Mirror the HTTP basic-auth posture: a 401 with WWW-Authenticate
      // so a browser opens its credential prompt. We do NOT count this
      // toward the IP lockout — repeat ws reconnect attempts can hammer
      // the auth guard otherwise — the HTTP layer already protects the
      // backing endpoints. (If we ever expose write APIs via ws, revisit.)
      socket.write(
        "HTTP/1.1 401 Unauthorized\r\n" +
        'WWW-Authenticate: Basic realm="CookingFoil"\r\n\r\n'
      );
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
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
    close() {
      clearInterval(hbTimer);
      unsubscribe();
      for (const ws of wss.clients) { try { ws.terminate(); } catch {} }
      wss.close();
    },
    clients: () => wss.clients.size,
  };
}
