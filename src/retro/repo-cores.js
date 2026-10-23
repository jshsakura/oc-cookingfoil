/**
 * RetroArch cores from the latest release of a GitHub repository the admin named
 * (core-settings.js repo()): each asset named <core>_libretro_libnx.nro, or .nro.zip
 * with the .nro alone inside, is that core. A bare .nro wins over a zip of the same core.
 *
 * GitHub gives each asset a SHA-256 (`digest`); when it does, the download must match it.
 * Downloads go over https and may be redirected only to GitHub's own download hosts.
 */
import { PackError } from "./pack-bundle.js";

export const GITHUB_HOSTS = ["https://github.com", "https://objects.githubusercontent.com", "https://release-assets.githubusercontent.com"];
const API_TIMEOUT_MS = 30_000;
const INDEX_TTL_MS = 10 * 60_000;
const ASSET_RE = /^([a-z0-9_]+)_libretro_libnx\.nro(\.zip)?$/;
const DIGEST_RE = /^sha256:([0-9a-f]{64})$/;

/** The release's cores as Map core → { date, tag, file, url, size, sha256, zipped, hosts }. Pure. */
export function parseRelease(release) {
  const out = new Map();
  const date = String(release?.published_at ?? "").slice(0, 10) || null;
  for (const a of release?.assets ?? []) {
    const m = String(a?.name ?? "").match(ASSET_RE);
    const url = String(a?.browser_download_url ?? "");
    if (!m || !url.startsWith("https://github.com/")) continue;
    const zipped = Boolean(m[2]);
    if (zipped && out.has(m[1]) && !out.get(m[1]).zipped) continue;
    out.set(m[1], {
      date, tag: String(release.tag_name ?? ""), file: a.name, url, size: Number(a.size) || null,
      sha256: String(a.digest ?? "").match(DIGEST_RE)?.[1] ?? null, zipped, hosts: GITHUB_HOSTS,
    });
  }
  return out;
}

let cached = { repo: null, at: 0, index: null };

/** The latest release's cores of `repo`, read again at most every ten minutes unless `fresh`. */
export async function fetchRepoIndex(repo, { fetchImpl = fetch, token = null, fresh = false, now = Date.now() } = {}) {
  if (!repo) throw PackError.of("noRepo", {}, { status: 400, reason: "no-repo" });
  if (!fresh && cached.repo === repo && now - cached.at < INDEX_TTL_MS) return cached.index;
  const res = await fetchImpl(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { "User-Agent": "oc-cookingfoil", Accept: "application/vnd.github+json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  }).catch((err) => {
    throw PackError.of("repoFailed", { repo, status: err.name === "TimeoutError" ? "timeout" : "fetch" }, { status: 502, reason: "download" });
  });
  if (!res.ok) throw PackError.of("repoFailed", { repo, status: res.status }, { status: 502, reason: "download" });
  const index = parseRelease(await res.json());
  cached = { repo, at: now, index };
  return index;
}

/** Forgets the cached release (tests, and the admin's update action). */
export const forgetRepoIndex = () => {
  cached = { repo: null, at: 0, index: null };
};
