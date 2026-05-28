/**
 * GET /api/shop/icon/:titleId
 *
 * Returns the locally-cached icon for a title (extracted from NACP in Phase 2c).
 * Falls back to a 1×1 transparent PNG when an icon isn't yet extracted —
 * this keeps the shop listing intact instead of returning 404, per the
 * no-omission invariant (FINDINGS §7).
 */
import fs from "fs";
import path from "path";
import debug from "../debug.js";
import { iconCacheDir } from "../helpers/envs.js";

const TRANSPARENT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64"
);

function normalizeTitleId(raw) {
  if (typeof raw !== "string") return null;
  const hex = raw.toUpperCase().replace(/[^0-9A-F]/g, "");
  return hex.length === 16 ? hex : null;
}

export default function iconRoute(req, res) {
  const titleId = normalizeTitleId(req.params.titleId);
  if (!titleId) {
    res.status(400).type("text/plain").send("invalid titleId");
    return;
  }
  const candidate = path.join(iconCacheDir, `${titleId}.jpg`);
  fs.access(candidate, fs.constants.R_OK, (err) => {
    if (!err) {
      res.type("image/jpeg").sendFile(candidate);
      return;
    }
    debug.file("icon miss for %s — returning placeholder", titleId);
    res.set("Cache-Control", "no-store");
    res.type("image/png").status(200).send(TRANSPARENT_PNG);
  });
}
