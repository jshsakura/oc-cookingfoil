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
import path from "node:path";
import * as env from "../helpers/envs.js";
import { requestLang } from "../meta/langs.js";
import { BRAND_LOGO, BRAND_MOTION_CSS } from "../views/brand-motion.js";

export const RESTART_HEADER = "X-CookingFoil-Restarting";

export const MESSAGE = Object.freeze({
  ko: "서버를 다시 시작하고 있습니다. 잠시 뒤 이어서 받습니다.",
  en: "The server is restarting. Downloads will continue in a moment.",
  ja: "サーバーを再起動しています。まもなく続きから受信します。",
  zh: "伺服器正在重新啟動，稍後會接著下載。",
});

// A response this large, or any Range request, counts as a download in the status.
export const DOWNLOAD_BYTES = 1024 * 1024;

/**
 * Whether a request counts as a download: a Range request, or a response of
 * DOWNLOAD_BYTES or more, once it is being answered with 200 or 206. Anyone can
 * send a Range header before sign-in; a refusal (401, 403, 404, 416, ...) or a
 * request not answered yet never counts, so it cannot hold the NSZ queue back.
 */
export const countsAsDownload = (req, res) =>
  res.headersSent && (res.statusCode === 200 || res.statusCode === 206) &&
  (Boolean(req.headers.range) || Number(res.getHeader("content-length")) >= DOWNLOAD_BYTES);

// The exit code of a restart asked for on the admin page (EX_TEMPFAIL): non-zero,
// so a supervisor that restarts only on failure (systemd Restart=on-failure)
// brings the server back too. A stop by signal exits 0.
export const RESTART_EXIT_CODE = 75;
// Whatever the grace setting, the process is gone this long after the drain
// starts, ahead of the SIGKILL that compose's stop_grace_period (40 s) sends.
const HARD_DEADLINE_MS = 35_000;

// How long a downloaded path counts as in use after its last piece, and how many are remembered.
const RECENT_MS = 2 * 60 * 1000;
const RECENT_MAX = 500;

const isDownload = countsAsDownload;
function requestPath(req) {
  try { return path.posix.normalize(decodeURIComponent(String(req.path ?? req.url ?? "").split("?")[0])); } catch { return null; }
}

/** /healthz and the admin restart API stay open; matched as the router would see the path. */
function exempt(raw) {
  let p;
  try { p = path.posix.normalize(decodeURIComponent(raw)); } catch { return false; }
  return p === "/healthz" || p.startsWith("/admin/api/server/");
}

// What a browser is told, in its own language: it waits on this page, which reloads itself.
const PAGE_TEXT = Object.freeze({
  ko: ["서버를 다시 시작하고 있습니다", "잠시 뒤 이 페이지를 다시 엽니다."],
  en: ["The server is restarting", "This page reloads in a moment."],
  ja: ["サーバーを再起動しています", "まもなくこのページを再読み込みします。"],
  zh: ["伺服器正在重新啟動", "稍後會自動重新載入此頁面。"],
});

// Self-contained: while the server drains, its stylesheets and fonts are refused too.
const page = (seconds, lang) => {
  const shown = PAGE_TEXT[lang] ? lang : "en";
  const [title, body] = PAGE_TEXT[shown];
  return `<!doctype html><html lang="${shown}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="${seconds}">
<title>CookingFoil</title><style>
:root{--ground:#f2f1ee;--surface:#fff;--ink:#16161a;--secondary:#55555e;--line:#e2e0da;--butter:#ffc23d;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--ground:#16161a;--surface:#1f1f24;--ink:#f2f1ee;--secondary:#a9a8a3;--line:#303037}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:16px;background:var(--ground);color:var(--ink);
font-family:Inter,"Noto Sans KR",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
main{width:100%;max-width:400px;padding:36px 28px;border:1px solid var(--line);border-radius:18px;background:var(--surface);text-align:center}
.brand{font-weight:800;letter-spacing:-.01em;font-size:15px;color:var(--secondary);margin-bottom:20px}
.restart-logo{display:block;width:80px;height:80px;margin:0 auto 12px}
${BRAND_MOTION_CSS}
h1{margin:0 0 8px;font-size:20px;line-height:1.35}
p{margin:0;color:var(--secondary);font-size:15px;line-height:1.5}
</style><main><img class="restart-logo brand-motion" src="${BRAND_LOGO}" alt="" width="80" height="80"><div class="brand">CookingFoil</div><h1>${title}</h1><p>${body}</p></main></html>`;
};

/**
 * One drain controller. `retryAfter` and `grace` return seconds; they are read
 * when the drain starts, so a setting saved on the admin page applies to the next one.
 */
export function createDrainer({ retryAfter = () => env.restartRetryAfter, grace = () => env.restartGrace, hardDeadlineMs = HARD_DEADLINE_MS } = {}) {
  const active = new Set();
  let state = null;
  let idleWaiters = [];
  let restartHandler = null;
  let shuttingDown = null;
  let signals = 0;
  // When the last download ended, and which paths were downloaded lately (path -> ms),
  // so background work (the NSZ queue) leaves the disks to consoles.
  let lastDownloadEnd = 0;
  const recentPaths = new Map();

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
      if (isDownload(req, res)) noteDownload(req);
      if (state) settle();
    });
  }

  function noteDownload(req) {
    const now = Date.now();
    lastDownloadEnd = now;
    const p = requestPath(req);
    if (!p) return;
    recentPaths.delete(p);
    recentPaths.set(p, now);
    // Oldest first: drop what is past the window, and never keep more than RECENT_MAX.
    for (const [k, t] of recentPaths) {
      if (recentPaths.size <= RECENT_MAX && now - t < RECENT_MS) break;
      recentPaths.delete(k);
    }
  }

  function refuse(req, res) {
    res.set({
      "Retry-After": String(state.retryAfter),
      Connection: "close",
      "Cache-Control": "no-store",
      [RESTART_HEADER]: headerValue(),
    });
    if ((req.headers.accept || "").includes("text/html")) return res.status(503).type("html").send(page(state.retryAfter, requestLang(req)));
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

  /** Downloads running now and when the last one ended (ms, 0 for never). */
  function downloads() {
    let running = 0;
    for (const { req, res } of active) if (isDownload(req, res)) running++;
    return { active: running, lastEndedAt: lastDownloadEnd };
  }

  /**
   * Whether a file is being downloaded, or was within `withinMs`: a console
   * downloads in Range pieces, so a moment between two pieces still counts.
   * `urlPath` is the decoded path the file is served at ("/dir/Game.nsp").
   */
  function pathInUse(urlPath, withinMs = RECENT_MS) {
    for (const { req } of active) if (requestPath(req) === urlPath) return true;
    const t = recentPaths.get(urlPath);
    return t !== undefined && Date.now() - t < withinMs;
  }

  function status() {
    return {
      draining: Boolean(state),
      restartId: state?.id ?? null,
      startedAt: state ? new Date(state.startedAt).toISOString() : null,
      backBy: state ? backBy() : null,
      retryAfter: state?.retryAfter ?? retryAfter(),
      graceSeconds: state ? state.graceMs / 1000 : grace(),
      inflight: active.size,
      downloads: downloads().active,
    };
  }

  const healthFields = () => ({ draining: Boolean(state), restart_id: state?.id ?? null });

  /**
   * The whole restart: drain, announce, wait for running requests (up to the
   * grace limit), clean up and exit with `exitCode`. Runs once; later calls get
   * the same promise. A hard deadline exits even if the cleanup hangs.
   */
  function shutdown({ server, announce, cleanup, exitCode = 0, exit = (code) => process.exit(code), log = () => {} } = {}) {
    if (shuttingDown) return shuttingDown;
    start({ server });
    let exited = false;
    const finish = () => { if (!exited) { exited = true; clearTimeout(deadline); exit(exitCode); } };
    const deadline = setTimeout(() => { log("restart: hard deadline reached, exiting"); finish(); }, Math.max(0, state.startedAt + hardDeadlineMs - Date.now()));
    shuttingDown = (async () => {
      try { announce?.(notice()); } catch (err) { log("restart: announce failed: %s", err.message); }
      log("restart: draining %d request(s), up to %ds", active.size, state.graceMs / 1000);
      const { cut } = await whenIdle();
      log(cut ? "restart: cut %d request(s) at the grace limit" : "restart: no request running, exiting", cut);
      try { await cleanup?.(); } catch (err) { log("restart: cleanup failed: %s", err.message); }
      finish();
    })();
    return shuttingDown;
  }

  /**
   * A SIGTERM/SIGINT: the first one drains (or joins a drain the admin page
   * started), a second one exits at once through `force` (or `exit`).
   */
  function signal(sig, { force, ...opts } = {}) {
    signals++;
    if (signals > 1) {
      (opts.log ?? (() => {}))("received %s again, exiting without waiting", sig);
      if (force) return force();
      return (opts.exit ?? ((code) => process.exit(code)))(0);
    }
    (opts.log ?? (() => {}))("received %s, draining before exit", sig);
    return shutdown(opts);
  }

  /** The admin page's restart button calls this; index.js says what it does. */
  const onRestartRequest = (fn) => { restartHandler = fn; };
  function requestRestart() {
    if (!restartHandler) return false;
    restartHandler();
    return true;
  }

  return { middleware, start, whenIdle, status, downloads, pathInUse, healthFields, notice: () => (state ? notice() : null), shutdown, signal, onRestartRequest, requestRestart, hasRestartHandler: () => Boolean(restartHandler), isShuttingDown: () => Boolean(shuttingDown) };
}

/** The server's own drain. */
const drainer = createDrainer();
export default drainer;
