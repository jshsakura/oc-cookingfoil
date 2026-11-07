/**
 * The GitHub side of firmware releases: the release list, every page, each
 * asked with If-None-Match. Nothing else is read from GitHub here: a console
 * downloads an asset from its own address at the source.
 *
 * Failures come back as SourceError with a `kind` the service records:
 * "network", "rate_limited" (403, 429), "not_found" (404, 410, 451) or "http".
 */
import { PAGE_SIZE, slimRelease } from "./versions.js";

const USER_AGENT = "oc-cookingfoil";
const API_TIMEOUT_MS = 20_000;
// 100 releases a page: far more versions than exist.
const MAX_PAGES = 20;

/** GitHub (or the network to it) did not give an answer to use; `kind` says how. */
export class SourceError extends Error {
  constructor(message, kind) {
    super(message);
    this.kind = kind;
  }
}

// 451 is how GitHub answers a repository taken down; like 404 and 410 it means the source is gone, not busy.
const kindOf = (status) => (status === 403 || status === 429 ? "rate_limited" : [404, 410, 451].includes(status) ? "not_found" : "http");

/** fetch, with a failure to connect (or a timeout) as a SourceError. */
async function ask(fetchImpl, url, init) {
  try {
    return await fetchImpl(url, init);
  } catch (err) {
    throw new SourceError(`could not reach ${new URL(url).host}: ${err.message}`, "network");
  }
}

/**
 * Every release of `repo`, newest first, as { pages: [{ etag, releases }], releases }. `kept` is
 * the pages read before from this same repository: a page GitHub answers 304 for is taken from it.
 */
export async function listReleases({ repo, kept = [], token = null, fetchImpl = fetch }) {
  const pages = [];
  for (let n = 1; n <= MAX_PAGES; n++) {
    const before = kept[n - 1];
    const headers = { "User-Agent": USER_AGENT, Accept: "application/vnd.github+json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(before?.etag ? { "If-None-Match": before.etag } : {}) };
    const res = await ask(fetchImpl, `https://api.github.com/repos/${repo}/releases?per_page=${PAGE_SIZE}&page=${n}`, { headers, signal: AbortSignal.timeout(API_TIMEOUT_MS) });
    let page;
    if (res.status === 304 && before) {
      page = before;
    } else if (!res.ok) {
      throw new SourceError(`GitHub answered ${res.status} for ${repo}`, kindOf(res.status));
    } else {
      let body;
      try {
        body = await res.json();
      } catch {
        throw new SourceError(`GitHub sent a release list that does not read for ${repo}`, "http");
      }
      if (!Array.isArray(body)) throw new SourceError(`GitHub sent no release list for ${repo}`, "http");
      page = { etag: res.headers.get("etag"), releases: body.map(slimRelease) };
    }
    pages.push(page);
    if (page.releases.length < PAGE_SIZE) break;
  }
  return { pages, releases: pages.flatMap((p) => p.releases) };
}
