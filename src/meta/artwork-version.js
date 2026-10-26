/**
 * Content versions for shop artwork URLs (/api/library/icon|banner|screenshot).
 *
 * Every URL a list or detail hands out ends in ?v=<12 hex>, a hash of what
 * decides the picture's bytes:
 *   - art the admin gave the game: its file's stamp (size and mtime), from memory (meta/game-meta.js);
 *   - else the file on disk (size and mtime): the icon read from the game file,
 *     which a banner is drawn from too (with BANNER_STYLE, how it is drawn).
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
 * list's ETag, once the shop cache is rebuilt: custom art uploads and NACP
 * extraction invalidate it already.
 */
import fs from "fs";
import crypto from "crypto";
import * as customArt from "./custom-art.js";
import { iconSource, bannerSource } from "./localized-art.js";
import { baseTitleIdOf, cachePathFor } from "./image-cache.js";
import { BANNER_STYLE } from "./icon-banner.js";

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
  if (kind === "icon") {
    if (iconSource(base, lang)) return fileKey(cachePathFor(base, "icon-lang", lang));
    if (customArt.hasOverride(base, "icon")) return `o:${customArt.stampOf(base, "icon", null)}`;
    return fileKey(cachePathFor(base, "icon"));
  }
  if (kind === "banner") {
    if (customArt.hasOverride(base, "banner")) return `o:${customArt.stampOf(base, "banner", null)}`;
    // Drawn from the icon it shows: the admin's, the language's own, or the game file's.
    if (customArt.hasOverride(base, "icon")) return `b${BANNER_STYLE}:o:${customArt.stampOf(base, "icon", null)}`;
    return `b${BANNER_STYLE}:${fileKey(cachePathFor(base, bannerSource(base, lang) ? "icon-lang" : "icon", lang))}`;
  }
  if (customArt.hasOverride(base, "screenshot", idx)) return `o:${customArt.stampOf(base, "screenshot", idx)}`;
  return "none";
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
