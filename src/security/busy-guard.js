/**
 * When the server has really fallen behind, requests are answered at once with
 * 503 and Retry-After instead of queueing behind the work, so a console sees
 * "try again" rather than a connection that hangs.
 *
 * "Behind" means the event loop ran more than BUSY_LAG_MS late on SUSTAINED_SAMPLES
 * samples in a row: one hiccup (a garbage collection, the start-up build) is not
 * enough. A browser gets a small page that reloads itself, never raw JSON.
 * /healthz always answers.
 */
import debug from "../debug.js";

const SAMPLE_MS = 250;
const BUSY_LAG_MS = 1000;
const SUSTAINED_SAMPLES = 3;
const RETRY_AFTER_S = 5;

let lateInARow = 0;
let timer = null;

function watch() {
  if (timer) return;
  let expected = Date.now() + SAMPLE_MS;
  timer = setInterval(() => {
    const now = Date.now();
    const late = Math.max(0, now - expected);
    lateInARow = late > BUSY_LAG_MS ? lateInARow + 1 : 0;
    if (lateInARow === SUSTAINED_SAMPLES) debug.log("busy: event loop behind for %d samples, answering 503 until it catches up", SUSTAINED_SAMPLES);
    expected = now + SAMPLE_MS;
  }, SAMPLE_MS);
  timer.unref();
}

/** Whether requests are being turned away right now. */
export const isBusy = () => lateInARow >= SUSTAINED_SAMPLES;

const PAGE = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="${RETRY_AFTER_S}">
<title>CookingFoil</title><body style="font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;color:#55555E">
<p>서버가 잠시 바쁩니다. 곧 다시 엽니다.<br>The server is busy for a moment. Reloading shortly.</p></body>`;

export default function busyGuard() {
  watch();
  return (req, res, next) => {
    if (!isBusy() || req.path === "/healthz") return next();
    res.set({ "Retry-After": String(RETRY_AFTER_S), "Cache-Control": "no-store" });
    if ((req.headers.accept || "").includes("text/html")) return res.status(503).type("html").send(PAGE);
    res.status(503).json({ error: "busy", retryAfter: RETRY_AFTER_S });
  };
}
