/**
 * GET /api/title/:baseTitleId/extras
 *
 * Lists auxiliary files that live alongside a title's game file(s) — mods,
 * patches, zips, readmes, save bundles — which the Tinfoil shop can't install
 * but are worth surfacing (and downloading) from the web dashboard. The shop
 * response intentionally omits these (Tinfoil would choke on a .zip), so this
 * is a web-UI-only view.
 *
 * Scope: a title's own subfolder. Files sitting directly in the games root are
 * skipped — there's no reliable way to associate a loose root file with one
 * specific title, and root tends to hold sidecars (shop.json, custom_entries).
 *
 * Download: extras are already served by the games-dir static handler, so the
 * returned `url` is a root-absolute, per-segment-encoded path that resolves
 * straight to the file (behind the same auth perimeter as everything else).
 */
import path from "path";
import fs from "fs/promises";

import { romsDirPath } from "../helpers/envs.js";
import * as shopCache from "../meta/shop-cache.js";
import { isGameFile } from "../create-index-content.js";
import debug from "../debug.js";

const TITLE_ID_RE = /^[0-9A-F]{16}$/;
// Server sidecars that may sit in a title folder but aren't user content.
const SIDECAR_NAMES = new Set(["shop.json", "shop.tfl"]);

function downloadUrl(relPath) {
  return "/" + relPath.split("/").map(encodeURIComponent).join("/");
}

export default async function extrasRoute(req, res) {
  const base = String(req.params.baseTitleId || "").toUpperCase();
  if (!TITLE_ID_RE.test(base)) {
    res.status(400).json({ error: "invalid titleId" });
    return;
  }

  try {
    await shopCache.get(); // ensure the library scan has populated filesMap
  } catch (err) {
    res.status(503).json({ error: "library not ready: " + err.message });
    return;
  }

  const rels = shopCache.relPathsForBase(base);
  // Distinct subfolders containing this title's files. "." (games root) is
  // excluded on purpose — see the scope note above.
  const dirs = new Set(
    rels.map((r) => path.dirname(r)).filter((d) => d && d !== ".")
  );

  const extras = [];
  const seen = new Set();
  for (const dir of dirs) {
    const absDir = path.join(romsDirPath, dir);
    let entries;
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true });
    } catch (err) {
      debug.error("extras: readdir %s: %s", dir, err.message);
      continue;
    }
    for (const ent of entries) {
      if (!ent.isFile()) continue;
      const name = ent.name;
      if (name.startsWith(".")) continue;          // dotfiles
      if (isGameFile(name)) continue;              // installable → already in shop
      if (SIDECAR_NAMES.has(name) || name.toLowerCase().endsWith(".tfl")) continue;
      const rel = path.posix.join(dir.split(path.sep).join("/"), name);
      if (seen.has(rel)) continue;
      seen.add(rel);
      let size = 0;
      try {
        size = (await fs.stat(path.join(absDir, name))).size;
      } catch { /* size best-effort */ }
      extras.push({
        name,
        size,
        ext: path.extname(name).slice(1).toLowerCase(),
        url: downloadUrl(rel),
      });
    }
  }

  extras.sort((a, b) => a.name.localeCompare(b.name));
  res
    .status(200)
    .type("application/json")
    .send(JSON.stringify({ baseTitleId: base, count: extras.length, extras }));
}
