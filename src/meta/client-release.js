/**
 * Follows the CookingFoil client's GitHub release, for a server whose admin
 * does not build the client (clientSource "github"; routes/client-update.js
 * then offers whichever of this file and the manual one is newer).
 *
 * The client is shipped to one fixed release tag (client-latest) whose asset,
 * cookingfoil.nro, is replaced in place (gh release upload --clobber), so a new
 * build shows as a new asset digest, not a new tag. The release is asked for
 * with If-None-Match, and a build is only taken when:
 *   - the asset exists and GitHub gives its sha256 digest,
 *   - the downloaded bytes have exactly the asset's size and that digest,
 *   - it is a CookingFoil NRO whose NACP version reads (meta/client-build.js),
 *   - that version is not lower than the build fetched before.
 * The checked bytes go to their own file (data/client/github/), never the
 * manual one, written beside it and renamed onto it, so a device mid-download
 * never gets half a file. A missing asset (the moment --clobber deletes it), a
 * failed check or GitHub being down all leave the fetched file as it is.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { ClientBuildError, compareVersions, inspectNro } from "./client-build.js";

const USER_AGENT = "oc-cookingfoil";
const API_TIMEOUT_MS = 20_000;
const DOWNLOAD_TIMEOUT_MS = 5 * 60_000;
// owner/name, neither of them "." or ".." (they would walk out of /repos/ in the URL).
export const REPO_RE = /^(?!\.\.?\/)[A-Za-z0-9_.-]+\/(?!\.\.?$)[A-Za-z0-9_.-]+$/;
// A release tag and an asset name, as GitHub allows them in a URL path segment.
export const TAG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
export const ASSET_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\.nro$/i;

/** A release whose build itself was turned down: remembered by digest so it isn't downloaded again. */
class Refused extends Error {
  constructor(message, sha256) {
    super(message);
    this.sha256 = sha256;
  }
}

/** sha256 hex from GitHub's asset digest ("sha256:<hex>"), or null. Pure. */
export function digestHex(digest) {
  const m = /^sha256:([0-9a-f]{64})$/i.exec(String(digest ?? ""));
  return m ? m[1].toLowerCase() : null;
}

/**
 * repo()      the "owner/name" to follow, or "" to follow nothing
 * tag()       the release tag (client-latest)
 * asset()     the asset's file name (cookingfoil.nro)
 * dest        where the fetched build is kept (data/client/github/cookingfoil.nro)
 * stateFile   where the ETag and the last fetched build are kept
 * current()   the build already at dest ({ version, size, sha256 }) or null
 * publish()   lets client-update.js choose what to offer again, once dest changed
 * token()     an optional GitHub token
 * maxBytes    the largest build accepted
 */
export function createClientRelease({ repo, tag = () => "client-latest", asset: assetName = () => "cookingfoil.nro", dest, stateFile, current, publish, token = () => null, fetchImpl = fetch, now = Date.now, maxBytes = 128 * 1024 * 1024 }) {
  let state = null;
  let running = null;

  const load = () => {
    if (state) return state;
    try {
      state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    } catch {
      state = {};
    }
    return state;
  };
  const save = (next) => {
    state = next;
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(`${stateFile}.tmp`, JSON.stringify(next));
    fs.renameSync(`${stateFile}.tmp`, stateFile);
  };
  const headers = (extra = {}) => {
    const auth = token();
    return { "User-Agent": USER_AGENT, Accept: "application/vnd.github+json", ...(auth ? { Authorization: `Bearer ${auth}` } : {}), ...extra };
  };

  async function download(asset, want) {
    const res = await fetchImpl(asset.browser_download_url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`download answered ${res.status}`);
    const chunks = [];
    let received = 0;
    for await (const chunk of res.body) {
      received += chunk.length;
      if (received > asset.size) throw new Error(`body is larger than the release's ${asset.size} bytes`);
      chunks.push(Buffer.from(chunk));
    }
    const buf = Buffer.concat(chunks);
    if (buf.length !== asset.size) throw new Error(`got ${buf.length} bytes, the release says ${asset.size}`);
    const got = crypto.createHash("sha256").update(buf).digest("hex");
    if (got !== want) throw new Error(`sha256 ${got.slice(0, 12)} is not the release's ${want.slice(0, 12)}`);
    return buf;
  }

  /** The release followed right now: its repository, tag and asset name, as one key the saved state belongs to. */
  const followed = () => ({ name: repo(), tagName: tag(), file: assetName() });
  const keyOf = ({ name, tagName, file }) => `${name}#${tagName}#${file}`;

  async function run(force) {
    const prev = load();
    const f = followed();
    const { name, tagName, file } = f;
    if (!name) return prev.error ? save({ ...prev, error: null }) : undefined;
    if (!REPO_RE.test(name)) throw new Error(`"${name}" is not an owner/name repository`);
    if (!TAG_RE.test(tagName)) throw new Error(`"${tagName}" is not a release tag`);
    if (!ASSET_RE.test(file)) throw new Error(`"${file}" is not an .nro file name`);
    const key = keyOf(f);
    // Another repository, tag or asset needs its release, not a 304 for the old one.
    const same = prev.source === key;
    const conditional = !force && prev.etag && same;
    const res = await fetchImpl(`https://api.github.com/repos/${name}/releases/tags/${tagName}`, {
      headers: headers(conditional ? { "If-None-Match": prev.etag } : {}),
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    // The same release: a build refused before stays refused.
    if (res.status === 304) return save({ ...prev, checked_at: now(), error: prev.refused ? prev.error : null });
    if (res.status === 404) throw new Error(`${name} has no ${tagName} release`);
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    const release = await res.json();
    const asset = (release.assets ?? []).find((a) => a.name === file);
    // Not saving the ETag means the next check reads the release again.
    if (!asset) throw new Error(`${tagName} has no ${file} right now`);
    const want = digestHex(asset.digest);
    if (!want) throw new Error(`GitHub gave no sha256 for ${file}`);
    if (!(asset.size > 0) || asset.size > maxBytes) throw new Error(`${file} is ${asset.size} bytes`);
    const done = { source: key, etag: res.headers.get("etag"), checked_at: now(), error: null, refused: null };
    const fetched = same ? prev.fetched ?? null : null;
    // Downloading a refused build again would only refuse it again (every check, up to maxBytes).
    if (!force && same && prev.refused === want) return save({ ...prev, ...done, error: prev.error, refused: want });
    const have = current();
    if (have?.sha256 === want) return save({ ...prev, ...done, fetched: fetched?.sha256 === want ? fetched : { version: have.version, sha256: want, at: now() } });
    const buf = await download(asset, want);
    let version;
    try {
      ({ version } = inspectNro(buf));
    } catch (err) {
      if (err instanceof ClientBuildError) throw Object.assign(new Refused(`${file} is not a CookingFoil build: ${err.message}`, want), { done });
      throw err;
    }
    // Only against the build fetched before from this same release (or one whose state was lost): the manual one is chosen apart.
    if ((same || !prev.source) && have && compareVersions(version, have.version) < 0) throw Object.assign(new Refused(`${version} is older than the ${have.version} fetched before`, want), { done });
    const part = `${dest}.part`;
    await fs.promises.mkdir(path.dirname(dest), { recursive: true });
    await fs.promises.writeFile(part, buf);
    await fs.promises.rename(part, dest);
    save({ ...prev, ...done, fetched: { version, sha256: want, at: now() } });
    await publish();
  }

  /** Checks the release now; one check at a time. Resolves to status(); a failure is kept in status().error. */
  async function check({ force = false } = {}) {
    // A forced check asks again even when a scheduled one is under way.
    if (force && running) await running;
    running ??= run(force)
      .catch((err) => {
        const error = { message: err.message, at: now(), source: keyOf(followed()) };
        const next = err instanceof Refused ? { ...load(), ...err.done, error, refused: err.sha256 } : { ...load(), checked_at: now(), error };
        // A disk that can't take the state file must not turn into an unhandled rejection.
        try {
          save(next);
        } catch {
          state = next;
        }
      })
      .finally(() => { running = null; });
    await running;
    return status();
  }

  /** What the admin page shows: the release followed, when it was last asked, the last build taken from it, the last error. */
  function status() {
    const s = load();
    const f = followed();
    const same = s.source === keyOf(f);
    // A failure is saved with the release it was for; the rest belongs to the release last read.
    const error = s.error?.source === keyOf(f) ? s.error : null;
    return { repo: f.name || null, tag: f.tagName, asset: f.file, checked_at: same ? s.checked_at ?? null : error?.at ?? null, fetched: same ? s.fetched ?? null : null, error };
  }

  return { check, status };
}
