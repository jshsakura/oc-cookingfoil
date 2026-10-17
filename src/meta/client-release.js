/**
 * Follows the CookingFoil client's GitHub release instead of waiting for a
 * build to be dropped in by hand.
 *
 * The client is shipped to one fixed release tag (client-latest) whose single
 * asset, cookingfoil.nro, is replaced in place (gh release upload --clobber),
 * so a new build shows as a new asset digest, not a new tag. The release is
 * asked for with If-None-Match, and a build is only taken when:
 *   - the asset exists and GitHub gives its sha256 digest,
 *   - the downloaded bytes have exactly the asset's size and that digest,
 *   - it is a CookingFoil NRO whose NACP version reads (meta/client-build.js),
 *   - that version is not lower than the build being offered.
 * The checked bytes are written beside the drop-in path and renamed onto it, so
 * the usual publishing (routes/client-update.js) picks them up whole; a device
 * mid-download never gets half a file. A missing asset (the moment --clobber
 * deletes it), a failed check or GitHub being down all leave the offered build
 * as it is.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { ClientBuildError, compareVersions, inspectNro } from "./client-build.js";

export const RELEASE_TAG = "client-latest";
export const RELEASE_ASSET = "cookingfoil.nro";
const USER_AGENT = "oc-cookingfoil";
const API_TIMEOUT_MS = 20_000;
const DOWNLOAD_TIMEOUT_MS = 5 * 60_000;
// owner/name, neither of them "." or ".." (they would walk out of /repos/ in the URL).
export const REPO_RE = /^(?!\.\.?\/)[A-Za-z0-9_.-]+\/(?!\.\.?$)[A-Za-z0-9_.-]+$/;

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
 * dest        the drop-in path (data/client/cookingfoil.nro)
 * stateFile   where the ETag and the last fetched build are kept
 * current()   the build being offered ({ version, size, sha256 }) or null
 * publish()   runs the usual publishing over dest and resolves when done
 * token()     an optional GitHub token
 * maxBytes    the largest build accepted
 */
export function createClientRelease({ repo, dest, stateFile, current, publish, token = () => null, fetchImpl = fetch, now = Date.now, maxBytes = 128 * 1024 * 1024 }) {
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

  async function run(force) {
    const prev = load();
    const name = repo();
    if (!name) return prev.error ? save({ ...prev, error: null }) : undefined;
    if (!REPO_RE.test(name)) throw new Error(`"${name}" is not an owner/name repository`);
    // A different repository needs its release, not a 304 for the old one.
    const conditional = !force && prev.etag && prev.repo === name;
    const res = await fetchImpl(`https://api.github.com/repos/${name}/releases/tags/${RELEASE_TAG}`, {
      headers: headers(conditional ? { "If-None-Match": prev.etag } : {}),
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    // The same release: a build refused before stays refused.
    if (res.status === 304) return save({ ...prev, checked_at: now(), error: prev.refused ? prev.error : null });
    if (res.status === 404) throw new Error(`${name} has no ${RELEASE_TAG} release`);
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    const release = await res.json();
    const asset = (release.assets ?? []).find((a) => a.name === RELEASE_ASSET);
    // Not saving the ETag means the next check reads the release again.
    if (!asset) throw new Error(`${RELEASE_TAG} has no ${RELEASE_ASSET} right now`);
    const want = digestHex(asset.digest);
    if (!want) throw new Error(`GitHub gave no sha256 for ${RELEASE_ASSET}`);
    if (!(asset.size > 0) || asset.size > maxBytes) throw new Error(`${RELEASE_ASSET} is ${asset.size} bytes`);
    const done = { repo: name, etag: res.headers.get("etag"), checked_at: now(), error: null, refused: null };
    const offered = current();
    // Downloading a refused build again would only refuse it again (every check, up to maxBytes).
    if (!force && prev.repo === name && prev.refused === want) return save({ ...prev, ...done, error: prev.error, refused: want });
    if (offered?.sha256 === want) return save({ ...prev, ...done, fetched: prev.fetched?.sha256 === want ? prev.fetched : { version: offered.version, sha256: want, at: now() } });
    const buf = await download(asset, want);
    let version;
    try {
      ({ version } = inspectNro(buf));
    } catch (err) {
      if (err instanceof ClientBuildError) throw Object.assign(new Refused(`${RELEASE_ASSET} is not a CookingFoil build: ${err.message}`, want), { done });
      throw err;
    }
    if (offered && compareVersions(version, offered.version) < 0) throw Object.assign(new Refused(`${version} is older than the offered ${offered.version}`, want), { done });
    const part = `${dest}.release-part`;
    await fs.promises.mkdir(path.dirname(dest), { recursive: true });
    await fs.promises.writeFile(part, buf);
    await fs.promises.rename(part, dest);
    await publish();
    if (current()?.sha256 !== want) throw Object.assign(new Refused(`${version} was fetched but not published`, want), { done });
    save({ ...prev, ...done, fetched: { version, sha256: want, at: now() } });
  }

  /** Checks the release now; one check at a time. Resolves to status(); a failure is kept in status().error. */
  async function check({ force = false } = {}) {
    // A forced check asks again even when a scheduled one is under way.
    if (force && running) await running;
    running ??= run(force)
      .catch((err) => {
        const error = { message: err.message, at: now(), repo: repo() || null };
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

  /** What the admin page shows: the repository, when it was last asked, the last build taken from it, the last error. */
  function status() {
    const s = load();
    const name = repo();
    return { repo: name || null, tag: RELEASE_TAG, asset: RELEASE_ASSET, checked_at: s.checked_at ?? null, fetched: s.repo === name || !name ? s.fetched ?? null : null, error: name && s.error && (s.error.repo ?? name) === name ? s.error : null };
  }

  return { check, status };
}
