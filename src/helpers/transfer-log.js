/**
 * One log line per large game-file response: how many bytes went out, how long
 * it took, the average speed, whether it was a byte range, and which client
 * asked (the first word of its User-Agent). Behind the tunnel this is the speed
 * the tunnel took the bytes at, which follows the console's own pace.
 * No address, device key or account is written.
 *
 *   transfer: 2048.0 MB in 160.4 s = 12.8 MB/s (full, Tinfoil) Game [0100…][v0].nsz
 */
import path from "path";
import debug from "../debug.js";

const MB = 1024 * 1024;

/** The client's name from its User-Agent ("Tinfoil/19.0" → "Tinfoil"). Pure. */
export function clientName(ua) {
  const first = String(ua ?? "").trim().split(/[\s/]/)[0];
  return /^[\w.-]{1,40}$/.test(first) ? first : "unknown";
}

/** The log line for one finished response, or null when it is too small to tell anything. Pure. */
export function transferLine({ bytes, ms, range, client, file }, minBytes = 32 * MB) {
  if (bytes < minBytes || ms <= 0) return null;
  const mb = bytes / MB;
  return `transfer: ${mb.toFixed(1)} MB in ${(ms / 1000).toFixed(1)} s = ${(mb / (ms / 1000)).toFixed(1)} MB/s (${range ? "range" : "full"}, ${client}) ${file}`;
}

export default function transferLog({ minBytes = 32 * MB } = {}) {
  return (req, res, next) => {
    const socket = req.socket;
    const before = socket?.bytesWritten ?? 0;
    const start = Date.now();
    res.on("close", () => {
      const line = transferLine({
        bytes: (socket?.bytesWritten ?? 0) - before,
        ms: Date.now() - start,
        range: Boolean(req.headers.range),
        client: clientName(req.headers["user-agent"]),
        file: path.posix.basename(decodeURIComponent(req.path)),
      }, minBytes);
      if (line) debug.log("%s", line);
    });
    next();
  };
}
