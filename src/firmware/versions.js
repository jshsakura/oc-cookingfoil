/**
 * Firmware versions and the GitHub releases they come from: which tags count,
 * how versions sort, which asset of a release is the zip, and how a new answer
 * from GitHub is laid over the list already kept (firmware/service.js). All pure.
 *
 * The list only grows from an answer GitHub gives: a version the source no
 * longer lists stays, marked gone upstream, so a console still sees it as
 * one it cannot get until the source lists it again.
 */
import { REPO_RE } from "../meta/client-release.js";

// A release tag that is a firmware version: three numbers and nothing else ("1.0.0pr" is not one).
export const VERSION_RE = /^\d{1,5}\.\d{1,5}\.\d{1,5}$/;
// GitHub pages hold at most this many releases.
export const PAGE_SIZE = 100;

/** Whether `repo` is an "owner/name" the server can follow; an empty or malformed one offers no firmware. Pure. */
export const isSource = (repo) => typeof repo === "string" && repo.length <= 140 && REPO_RE.test(repo);

/** Numeric order of two versions, oldest first (9.0.0 before 10.0.0). Pure. */
export function compareVersions(a, b) {
  const x = a.split(".").map(Number);
  const y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/** The newest version first. Pure. */
export const newestFirst = (versions) => [...versions].sort((a, b) => compareVersions(b, a));

/** A release as GitHub gives it, cut to what the list needs, so the kept pages stay small. Pure. */
export function slimRelease(r) {
  return {
    tag_name: String(r?.tag_name ?? ""),
    draft: Boolean(r?.draft),
    published_at: r?.published_at ?? r?.created_at ?? null,
    assets: (Array.isArray(r?.assets) ? r.assets : []).map((a) => ({
      id: a?.id ?? null,
      name: String(a?.name ?? ""),
      size: Number(a?.size) || 0,
      url: String(a?.browser_download_url ?? ""),
      digest: a?.digest ?? null,
      state: a?.state ?? "uploaded",
    })),
  };
}

/** The zip of a release: one named after its version when there are several. Pure. */
function zipAsset(release, version) {
  const zips = release.assets.filter((a) => /\.zip$/i.test(a.name) && a.size > 0 && a.state === "uploaded" && /^https:\/\//.test(a.url));
  return zips.find((a) => a.name.includes(version)) ?? zips[0] ?? null;
}

/**
 * The versions a list of (slim) releases offers: version -> { released, asset }.
 * Drafts, tags that are not a version and releases without a zip are left out;
 * a version given twice keeps its first release (GitHub lists the newest first). Pure.
 */
export function upstreamVersions(releases) {
  const out = new Map();
  for (const r of releases) {
    const version = r.tag_name;
    if (r.draft || !VERSION_RE.test(version) || out.has(version)) continue;
    const asset = zipAsset(r, version);
    if (!asset) continue;
    out.set(version, { released: typeof r.published_at === "string" ? r.published_at.slice(0, 10) : "", asset });
  }
  return out;
}

/**
 * Why an answer from the same source must not replace the kept list, or null when it may:
 * it lists nothing, or fewer than half the versions the source listed before. Pure.
 */
export function shrinkProblem(upstream, kept, sameSource) {
  if (!upstream.size) return "the source lists no firmware release";
  if (!sameSource) return null;
  const known = Object.values(kept).filter((e) => e.upstream).length;
  return upstream.size * 2 < known ? `the source lists ${upstream.size} versions, fewer than half the ${known} known` : null;
}

/**
 * The kept versions with a good answer laid over them. A version the source lists takes its
 * release and asset. From the same source, a version it no longer lists stays with upstream
 * false. From another source (the setting changed), only what it lists is kept. Pure.
 */
export function mergeUpstream(kept, upstream, { sameSource }) {
  const next = {};
  for (const [version, { released, asset }] of upstream) next[version] = { released, asset, upstream: true };
  if (sameSource) for (const [version, prev] of Object.entries(kept)) if (!next[version]) next[version] = { ...prev, upstream: false };
  return next;
}
