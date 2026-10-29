/**
 * GET /api/title/:baseTitleId/extras
 *
 * Lists auxiliary files that live alongside a title's game file(s): mods,
 * patches, zips, save bundles. A README.md is the operator's notes and is left
 * out (helpers/readme-name.js). A console does not install them, but
 * they are worth surfacing (and downloading) from the web page. The catalog
 * leaves them out, so this is a web-UI-only view.
 *
 * Scope: a title's own subfolder. Files sitting directly in the games root are
 * skipped — there's no reliable way to associate a loose root file with one
 * specific title, and root tends to hold sidecars (the old catalog files, custom_entries).
 *
 * Download: extras are already served by the games-dir static handler, so the
 * returned `url` is a root-absolute, per-segment-encoded path that resolves
 * straight to the file (behind the same auth perimeter as everything else).
 * For a client that asked for the direct address, `url` is on it
 * (security/download-links.js).
 */
import path from "path";
import fs from "fs/promises";

import { romsDirPath } from "../helpers/envs.js";
import * as libraryCache from "../meta/library-cache.js";
import { isGameFile } from "../create-index-content.js";
import { isReadme } from "../helpers/readme-name.js";
import debug from "../debug.js";
import { directUrl, forRequest } from "../security/download-links.js";

const TITLE_ID_RE = /^[0-9A-F]{16}$/;

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
    await libraryCache.get(); // ensure the library scan has populated filesMap
  } catch (err) {
    res.status(503).json({ error: "library not ready: " + err.message });
    return;
  }

  const rels = libraryCache.relPathsForBase(base);
  // Distinct subfolders containing this title's files. "." (games root) is
  // excluded on purpose — see the scope note above.
  const dirs = new Set(
    rels.map((r) => path.dirname(r)).filter((d) => d && d !== ".")
  );

  const extras = [];
  const seen = new Set();
  const link = forRequest(req);
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
      if (isGameFile(name)) continue;              // installable → already in library
      if (isReadme(name)) continue;                // the operator's notes, not the game's
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
        url: directUrl(downloadUrl(rel), link),
      });
    }
  }

  extras.sort((a, b) => a.name.localeCompare(b.name));
  res
    .status(200)
    .type("application/json")
    .send(JSON.stringify({ baseTitleId: base, count: extras.length, extras }));
}
