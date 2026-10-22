/**
 * GET /api/client-config: a config.json for the CookingFoil client that points
 * at this server. It carries no password, access key or Cloudflare secret; a
 * console pairs (QR, or the download token) to get its access key.
 */
import { requestLang } from "../meta/langs.js";
import { resolveOrigin } from "../helpers/origin.js";
import { publicBaseUrl } from "../helpers/envs.js";

export default function clientConfigRoute(req, res) {
  const origin = resolveOrigin(req, publicBaseUrl);
  if (!origin) return res.status(503).json({ error: "server origin unavailable" });
  // Named after the shop's host (language-neutral), in the language of whoever downloads it.
  const server = {
    title: new URL(origin).hostname,
    url: origin,
    username: "",
    password: "",
    cfClientId: "",
    cfClientSecret: "",
    enabled: true,
  };
  res.set({ "Cache-Control": "no-store", "Content-Disposition": 'attachment; filename="config.json"' });
  res.type("application/json").send(JSON.stringify({ servers: [server], language: requestLang(req), installTarget: "sd" }, null, 2) + "\n");
}
