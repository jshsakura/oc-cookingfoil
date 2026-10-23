/**
 * GET /api/title/:baseTitleId
 *
 * On-demand rich detail for one base title — description, publisher, region,
 * release date, rating, players, plus proxied icon/banner/screenshot URLs.
 *
 * Why a dedicated endpoint: the catalog carries no `titledb` map, so this rich
 * metadata never rides along with /shop.json or the sections list. The
 * data still lives in the warmed titledb store, so we surface it here — fetched
 * only when a title is opened, keeping the list itself lean. Falls back to
 * NACP-extracted metadata for titles blawar's titledb doesn't carry.
 *
 * Artwork URLs point at our proxy endpoints (/api/shop/icon|banner|screenshot)
 * and are made origin-absolute like the shop/sections payloads so on-device
 * clients can curl them verbatim; a same-origin browser keeps the relative form.
 */
import { titleDetail } from "../meta/title-detail.js";
import { resolveOrigin } from "../helpers/origin.js";
import { publicBaseUrl } from "../helpers/envs.js";
import { requestLang } from "../meta/langs.js";
import { forRequest } from "../security/download-links.js";
import { withPatchDirect } from "./patches.js";

const TITLE_ID_RE = /^[0-9A-F]{16}$/;

export default async function titleDetailRoute(req, res) {
  const base = String(req.params.baseTitleId || "").toUpperCase();
  if (!TITLE_ID_RE.test(base)) {
    res.status(400).json({ error: "invalid titleId" });
    return;
  }
  const lang = requestLang(req);
  const asked = req.query?.lang || req.get?.("accept-language") ? lang : null;
  const detail = await titleDetail(base, { lang, asked, origin: resolveOrigin(req, publicBaseUrl) });
  const link = forRequest(req);
  if (!detail) {
    res.status(404).json({ error: "no metadata for title" });
    return;
  }
  // titledb changes at most on the ~24h refresh; let the dashboard/client hold
  // a detail for a minute instead of re-fetching on every open.
  res.header("Cache-Control", "private, max-age=60");
  res.header("Vary", "Accept-Language");
  res.json(link ? { ...detail, patches: detail.patches.map((p) => withPatchDirect(p, link)) } : detail);
}
