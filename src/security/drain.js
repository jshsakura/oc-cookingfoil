/**
 * Safe restart (drain). When the server is about to stop, it stops taking new
 * work instead of cutting the downloads that are running:
 *
 *   new requests       503 + Retry-After + Connection: close, and a small JSON
 *                      notice ({ error: "restarting", restart_id, retry_after,
 *                      back_by, message: { ko, en, ja, zh } }); a browser gets a
 *                      page that reloads itself
 *   running requests   finish normally, up to the grace limit; anything still
 *                      running then is cut. Their responses carry Connection:
 *                      close so no socket is kept for a next request
 *   idle keep-alive    closed at once
 *
 * Every response during the drain carries X-CookingFoil-Restarting:
 * "<retry_after>; id=<restart_id>", so a client can show the notice once per
 * restart. /healthz and the admin page's /admin/api/server/* stay open.
 *
 * Console clients download in Range pieces of a few seconds each, so a running
 * request ends long before the grace limit and the next piece simply waits for
 * Retry-After. Retry-After and the grace limit are server settings
 * (restartRetryAfter, restartGrace) that apply without a restart.
 */
import crypto from "node:crypto";
import * as env from "../helpers/envs.js";

export const RESTART_HEADER = "X-CookingFoil-Restarting";

export const MESSAGE = Object.freeze({
  ko: "서버를 다시 시작하고 있습니다. 잠시 뒤 이어서 받습니다.",
  en: "The server is restarting. Downloads will continue in a moment.",
  ja: "サーバーを再起動しています。まもなく続きから受信します。",
  zh: "伺服器正在重新啟動，稍後會接著下載。",
});

// A response this large, or any Range request, counts as a download in the status.
const DOWNLOAD_BYTES = 1024 * 1024;

const exempt = (p) => p === "/healthz" || p.startsWith("/admin/api/server/");

const page = (seconds) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="${seconds}">
<title>CookingFoil</title><body style="font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;color:#55555E">
<p>${MESSAGE.ko}<br>${MESSAGE.en}</p></body>`;

/**
 * One drain controller. `retryAfter` and `grace` return seconds; they are read
 * when the drain starts, so a setting saved on the admin page applies to the next one.
 */
export function createDrainer({ retryAfter = () => env.restartRetryAfter, grace = () => env.restartGrace } = {}) {
  const active = new Set();
  let state = null;
  let idleWaiters = [];
  let restartHandler = null;
  let shuttingDown = null;

  const headerValue = () => `${state.retryAfter}; id=${state.id}`;
  const backBy = () => new Date(Date.now() + state.retryAfter * 1000).toISOString();

  function settle() {
    if (active.size !== 0) return;
    const waiters = idleWaiters;
    idleWaiters = [];
    for (const w of waiters) w({ cut: 0 });
  }

  function track(req, res) {
    const entry = { req, res };
    active.add(entry);
    // A response whose headers go out during the drain says so and gives up keep-alive.
    const writeHead = res.writeHead;
    res.writeHead = function (...args) {
      if (state && !this.headersSent) {
        this.setHeader(RESTART_HEADER, headerValue());
        this.setHeader("Connection", "close");
      }
      return writeHead.apply(this, args);
    };
    res.once("close", () => {
      active.delete(entry);
      if (state) settle();
    });
  }

  function refuse(req, res) {
    res.set({
      "Retry-After": String(state.retryAfter),
      Connection: "close",
      "Cache-Control": "no-store",
      [RESTART_HEADER]: headerValue(),
    });
    if ((req.headers.accept || "").includes("text/html")) return res.status(503).type("html").send(page(state.retryAfter));
    res.status(503).json(notice());
  }

  /** What a client is told: the 503 body and the websocket announcement. */
  function notice() {
    return { error: "restarting", restart_id: state.id, retry_after: state.retryAfter, back_by: backBy(), message: MESSAGE };
  }

  function middleware() {
    return (req, res, next) => {
      if (exempt(req.path)) {
        if (state) res.set(RESTART_HEADER, headerValue());
        return next();
      }
      if (state) return refuse(req, res);
      track(req, res);
      next();
    };
  }

  /** Starts the drain (once; a second call returns the same drain). */
  function start({ server } = {}) {
    if (!state) {
      state = {
        id: `${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`,
        startedAt: Date.now(),
        retryAfter: retryAfter(),
        graceMs: Math.max(0, grace() * 1000),
      };
    }
    // Sockets waiting for a next request would otherwise hold the exit; a busy one closes after its response.
    server?.closeIdleConnections?.();
    return { ...state };
  }

  /** Resolves when no request is running, or at the grace limit after cutting what still is. */
  function whenIdle() {
    if (active.size === 0) return Promise.resolve({ cut: 0 });
    const left = state ? Math.max(0, state.startedAt + state.graceMs - Date.now()) : 0;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        idleWaiters = idleWaiters.filter((w) => w !== done);
        const cut = active.size;
        for (const { res } of active) res.socket?.destroy();
        resolve({ cut });
      }, left);
      const done = (r) => { clearTimeout(timer); resolve(r); };
      idleWaiters.push(done);
    });
  }

  function status() {
    let downloads = 0;
    for (const { req, res } of active) {
      if (req.headers.range || Number(res.getHeader("content-length")) >= DOWNLOAD_BYTES) downloads++;
    }
    return {
      draining: Boolean(state),
      restartId: state?.id ?? null,
      startedAt: state ? new Date(state.startedAt).toISOString() : null,
      backBy: state ? backBy() : null,
      retryAfter: state?.retryAfter ?? retryAfter(),
      graceSeconds: state ? state.graceMs / 1000 : grace(),
      inflight: active.size,
      downloads,
    };
  }

  const healthFields = () => ({ draining: Boolean(state), restart_id: state?.id ?? null });

  /**
   * The whole restart: drain, announce, wait for running requests (up to the
   * grace limit), clean up and exit. Runs once; later calls get the same promise.
   */
  function shutdown({ server, announce, cleanup, exit = (code) => process.exit(code), log = () => {} } = {}) {
    if (shuttingDown) return shuttingDown;
    start({ server });
    shuttingDown = (async () => {
      try { announce?.(notice()); } catch (err) { log("restart: announce failed: %s", err.message); }
      log("restart: draining %d request(s), up to %ds", active.size, state.graceMs / 1000);
      const { cut } = await whenIdle();
      log(cut ? "restart: cut %d request(s) at the grace limit" : "restart: no request running, exiting", cut);
      try { await cleanup?.(); } catch (err) { log("restart: cleanup failed: %s", err.message); }
      exit(0);
    })();
    return shuttingDown;
  }

  /** The admin page's restart button calls this; index.js says what it does. */
  const onRestartRequest = (fn) => { restartHandler = fn; };
  function requestRestart() {
    if (!restartHandler) return false;
    restartHandler();
    return true;
  }

  return { middleware, start, whenIdle, status, healthFields, notice: () => (state ? notice() : null), shutdown, onRestartRequest, requestRestart, hasRestartHandler: () => Boolean(restartHandler), isShuttingDown: () => Boolean(shuttingDown) };
}

/** The server's own drain. */
const drainer = createDrainer();
export default drainer;
