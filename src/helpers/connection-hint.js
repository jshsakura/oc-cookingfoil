/**
 * X-CookingFoil-Max-Connections: how many connections one console may open
 * for one download (parallel Range requests), the admin's setting
 * (server-settings downloadMaxConnections, default 4). It rides on every
 * response a client reads lists or downloads from, so the client learns it
 * without asking; images leave it out. Only a hint: nothing here counts or
 * refuses connections, and a client may open fewer.
 *
 * X-CookingFoil-Active-Downloads: how many consoles are downloading from this
 * server right now, the caller included if it is one of them. A client that
 * tunes its connection count stays lower when others share the line. It is
 * added only when the response goes out with a status under 400: a request the
 * guards after this one refuse (a pairing-only library's deviceContentGuard) never
 * learns how busy the server is.
 */
import { downloadMaxConnections } from "./envs.js";
import transferLog from "./transfer-log.js";

export const MAX_CONNECTIONS_HEADER = "X-CookingFoil-Max-Connections";
export const ACTIVE_DOWNLOADS_HEADER = "X-CookingFoil-Active-Downloads";
const IMAGE_RE = /\/(icon|banner|screenshot|boxart|bezel\.png)(\/|$)/;

export default function connectionHint() {
  return (req, res, next) => {
    if ((req.method === "GET" || req.method === "HEAD") && !IMAGE_RE.test(req.path)) {
      res.set(MAX_CONNECTIONS_HEADER, String(downloadMaxConnections));
      const writeHead = res.writeHead;
      res.writeHead = function (...args) {
        const status = typeof args[0] === "number" ? args[0] : this.statusCode;
        if (status < 400 && !this.headersSent) this.setHeader(ACTIVE_DOWNLOADS_HEADER, String(transferLog.downloaders()));
        return writeHead.apply(this, args);
      };
    }
    next();
  };
}
