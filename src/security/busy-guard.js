/**
 * When the server falls behind (its event loop running more than BUSY_LAG_MS
 * late), requests are answered at once with 503 and Retry-After instead of
 * queueing behind the work, so a console sees "try again" rather than a
 * connection that hangs. /healthz always answers.
 */
import debug from "../debug.js";

const SAMPLE_MS = 250;
const BUSY_LAG_MS = 1000;
const RETRY_AFTER_S = 5;

let lag = 0;
let timer = null;

function watch() {
  if (timer) return;
  let expected = Date.now() + SAMPLE_MS;
  timer = setInterval(() => {
    const now = Date.now();
    const late = Math.max(0, now - expected);
    if (late > BUSY_LAG_MS && lag <= BUSY_LAG_MS) debug.log("busy: event loop %d ms late, answering 503 until it catches up", late);
    lag = late;
    expected = now + SAMPLE_MS;
  }, SAMPLE_MS);
  timer.unref();
}

/** How late the event loop was at the last sample, in ms. */
export const currentLag = () => lag;

export default function busyGuard() {
  watch();
  return (req, res, next) => {
    if (lag <= BUSY_LAG_MS || req.path === "/healthz") return next();
    res.set({ "Retry-After": String(RETRY_AFTER_S), "Cache-Control": "no-store" });
    res.status(503).json({ error: "busy", retryAfter: RETRY_AFTER_S });
  };
}
