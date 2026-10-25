/**
 * Content versions for shop artwork URLs (/api/library/icon|banner|screenshot).
 *
 * Every URL a list or detail hands out ends in ?v=<12 hex>, a hash of what
 * decides the picture's bytes:
 *   - art the admin gave the game: its file's stamp (size and mtime), from memory (meta/game-meta.js);
 *   - else the image titledb names (the eShop URL, or that language's own);
 *   - else the file on disk (size and mtime): an icon read from the game file.
 * plus ART_PIPELINE, the version of the resize/WebP encoding. Bump it when
 * image-cache changes how a variant is drawn, so a cached ?size= variant is
 * never replaced under the same URL. The size (?size=) is not part of v: the
 * client appends &size=md or &size=xl to the URL as it is.
 *
 * The routes compare the request's v with the current one: equal means the URL
 * names exactly these bytes, so they may be kept for a year (immutable).
 * Anything else (no v, the old app-version v, a stale hash) gets a short cache
 * and an ETag, so an older client is never stuck with a replaced picture.
 *
 * Because v is part of the list's JSON, a changed picture also changes the
 * list's ETag, once the shop cache is rebuilt: custom art uploads, titledb
 * reloads and NACP extraction all invalidate it already.
 */
import fs from "fs";
import crypto from "crypto";
import * as titledbStore from "./titledb-store.js";
import * as customArt from "./custom-art.js";
import { iconSource, bannerSource } from "./localized-art.js";
import { baseTitleIdOf, cachePathFor } from "./image-cache.js";

export const ART_PIPELINE = 1;
const PATH_RE = /\/(icon|banner|screenshot)\/([0-9A-Fa-f]{16})(?:\/(\d+))?$/;

function fileKey(file) {
  try {
    const st = fs.statSync(file);
    return `f:${st.size}:${st.mtimeMs}`;
  } catch {
    return "none";
  }
}

/** What decides the bytes of one artwork slot (see the header). */
function sourceKey(kind, base, { idx = 0, lang = null } = {}) {
  const entry = titledbStore.get(base);
  if (kind === "icon") {
    const own = iconSource(base, lang);
    if (own?.url) return `u:${own.url}`;
    if (own) return fileKey(cachePathFor(base, "icon-lang", lang));
    if (customArt.hasOverride(base, "icon")) return `o:${customArt.stampOf(base, "icon", null)}`;
    return entry?.iconUrl ? `u:${entry.iconUrl}` : fileKey(cachePathFor(base, "icon"));
  }
  if (kind === "banner") {
    const own = bannerSource(base, lang);
    if (own) return `u:${own}`;
    if (customArt.hasOverride(base, "banner")) return `o:${customArt.stampOf(base, "banner", null)}`;
    return entry?.bannerUrl ? `u:${entry.bannerUrl}` : fileKey(cachePathFor(base, "banner"));
  }
  if (customArt.hasOverride(base, "screenshot", idx)) return `o:${customArt.stampOf(base, "screenshot", idx)}`;
  const shot = Array.isArray(entry?.screenshots) ? entry.screenshots[idx] : null;
  return shot ? `u:${shot}` : fileKey(cachePathFor(base, "screenshot", idx));
}

/** The current v for one slot: 12 hex characters. Updates and DLC share their game's art. */
export function artworkVersion(kind, titleId, { idx = 0, lang = null } = {}) {
  const base = baseTitleIdOf(String(titleId).toUpperCase());
  // A language without its own art is served the default picture, so it has the default's v.
  const own = kind === "icon" ? iconSource(base, lang) : kind === "banner" ? bannerSource(base, lang) : null;
  const l = own ? lang : null;
  const key = `${ART_PIPELINE}\0${kind}\0${base}\0${idx}\0${l ?? ""}\0${sourceKey(kind, base, { idx, lang: l })}`;
  return crypto.createHash("sha1").update(key).digest("hex").slice(0, 12);
}

/** `path?v=<hash>`, plus `&lang=` for a language's own art. */
export function versionedArtwork(path, lang = null) {
  const m = PATH_RE.exec(path);
  if (!m) return path;
  const v = artworkVersion(m[1], m[2], { idx: Number(m[3] ?? 0), lang });
  return `${path}?v=${v}${lang ? `&lang=${lang}` : ""}`;
}

/** Whether the request names the current bytes of the slot by its v. */
export function isCurrentVersion(req, kind, titleId, opts) {
  const v = req.query?.v;
  return typeof v === "string" && v === artworkVersion(kind, titleId, opts);
}
