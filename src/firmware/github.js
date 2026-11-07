/**
 * The GitHub side of firmware releases: the release list (every page, each
 * asked with If-None-Match), a range of an asset (its zip's tail), and an
 * asset downloaded to a file with its sha256. Asset addresses redirect to
 * GitHub's storage; fetch follows them here, so a console never sees one.
 *
 * Failures come back as SourceError with a `kind` the service records:
 * "network", "rate_limited" (403, 429), "not_found" (404), "http", or "size"
 * for a download whose body is not the asset's size (a bad archive, not an outage).
 */
import crypto from "crypto";
import fs from "fs";
import { Readable, Transform } from "stream";
import { pipeline } from "stream/promises";
import { PAGE_SIZE, slimRelease } from "./versions.js";

const USER_AGENT = "oc-cookingfoil";
const API_TIMEOUT_MS = 20_000;
const RANGE_TIMEOUT_MS = 30_000;
// A firmware zip is a few hundred MB; an hour covers a slow line, and a stalled one ends there.
const DOWNLOAD_TIMEOUT_MS = 60 * 60_000;
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

/** Bytes start..end (inclusive) of the asset at `url`, which is `size` bytes long. */
export async function fetchRange({ url, start, end, size, fetchImpl = fetch }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RANGE_TIMEOUT_MS);
  try {
    const res = await ask(fetchImpl, url, { headers: { "User-Agent": USER_AGENT, Range: `bytes=${start}-${end}` }, signal: controller.signal });
    // A 200 would be the whole zip: never read it for a few KB of directory.
    if (res.status !== 206) {
      controller.abort();
      throw new SourceError(`the asset answered ${res.status} to a range request`, res.status === 200 ? "http" : kindOf(res.status));
    }
    const total = /\/(\d+)$/.exec(res.headers.get("content-range") ?? "")?.[1];
    if (total !== undefined && Number(total) !== size) {
      controller.abort();
      throw new SourceError(`the asset is ${total} bytes, the release says ${size}`, "http");
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length !== end - start + 1) throw new SourceError(`asked for ${end - start + 1} bytes, got ${buf.length}`, "http");
    return buf;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Downloads the asset at `url` into `dest` (created or replaced), refusing a body other than
 * `size` bytes. Resolves to its sha256; `onBytes(n)` hears how far it got.
 */
export async function downloadAsset({ url, dest, size, fetchImpl = fetch, onBytes = () => {} }) {
  const res = await ask(fetchImpl, url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!res.ok || !res.body) throw new SourceError(`the asset answered ${res.status}`, kindOf(res.status));
  const hash = crypto.createHash("sha256");
  let received = 0;
  const count = new Transform({
    transform(chunk, _enc, cb) {
      received += chunk.length;
      if (received > size) return cb(new SourceError(`the asset is larger than the release's ${size} bytes`, "size"));
      hash.update(chunk);
      onBytes(received);
      cb(null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(res.body), count, fs.createWriteStream(dest));
  } catch (err) {
    if (err instanceof SourceError) throw err;
    // The disk refusing the file is this server's problem, not the source's.
    if (err.code === "ENOSPC" || err.code === "EACCES" || err.code === "EROFS") throw err;
    throw new SourceError(`the download broke off: ${err.message}`, "network");
  }
  if (received !== size) throw new SourceError(`got ${received} bytes, the release says ${size}`, "size");
  return hash.digest("hex");
}
