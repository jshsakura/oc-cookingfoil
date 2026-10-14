/**
 * X-CookingFoil-Max-Connections: how many connections one console may open
 * for one download (parallel Range requests), the admin's setting
 * (server-settings downloadMaxConnections, default 4). It rides on every
 * response a client reads lists or downloads from, so the client learns it
 * without asking; images leave it out. Only a hint: nothing here counts or
 * refuses connections, and a client may open fewer.
 */
import { downloadMaxConnections } from "./envs.js";

export const MAX_CONNECTIONS_HEADER = "X-CookingFoil-Max-Connections";
const IMAGE_RE = /\/(icon|banner|screenshot|boxart|bezel\.png)(\/|$)/;

export default function connectionHint() {
  return (req, res, next) => {
    if ((req.method === "GET" || req.method === "HEAD") && !IMAGE_RE.test(req.path)) {
      res.set(MAX_CONNECTIONS_HEADER, String(downloadMaxConnections));
    }
    next();
  };
}
