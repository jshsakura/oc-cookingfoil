/**
 * The CookingFoil client updating itself.
 *
 *   GET /api/client/latest           { version, size, sha256, signature?, url, forwarder_title_id },
 *                                    or 404 when no build is there; url is on the
 *                                    direct address for a client that asked for it (security/download-links.js)
 *   GET /api/client/cookingfoil.nro  the build itself (Content-Length, ETag = its sha256)
 *   GET /api/client/icon             the build's own icon (for the web page's download card)
 *   POST /api/client/log             a console's error log (see client-log.js)
 *   GET /api/client/strings?lang=xx  the client's strings for one language, {lang, base, strings}
 *                                    (meta/client-strings.js); ETag and 304, 404 for a language
 *                                    the server has no table for
 *
 * A build is published by dropping it at <data dir>/client/cookingfoil.nro, or
 * uploading it on the admin page (admin/upload-api.js, kind "client")
 * (written elsewhere and moved in; a .tmp beside it is never read). Whenever its
 * size or mtime changes it is checked (meta/client-build.js: NRO header and size,
 * ASET, NACP, an x.y.z version not lower than the last one). A build that passes
 * is copied to client/.published/ with its facts, and that copy is what is
 * offered and served, so size and sha256 always describe the bytes sent. A build
 * that fails is logged and shown on the admin page, and the last good one stays. The
 * forwarder_title_id is the title ID of the client's own HOME-menu shortcut, which the
 * console builds itself; it lets the client recognise a shortcut it installed.
 *
 * The build can also come from GitHub (clientSource "github"): the server
 * follows a release (clientReleaseRepo, clientReleaseTag, clientReleaseAsset)
 * and keeps what it fetched apart, in client/github/cookingfoil.nro
 * (meta/client-release.js), so it never touches the manual file. Then the newer
 * of the two is offered, the manual one when they are the same version, so a
 * build uploaded by hand goes out at once. In "manual" mode (the default)
 * GitHub is not asked and only the manual file counts. `source` in the offered
 * build's facts says which one it is.
 *
 * The build's signature is made where the build is (never on this server) and
 * dropped beside it as cookingfoil.nro.sig.json:
 *   { "version", "size", "sha256", "signature": <128 hex, Ed25519> }
 * It is optional: it rides on /latest only while its version, size and sha256
 * are the build's being offered, and a build without one is offered all the
 * same. The server never checks or makes signatures and holds no key.
 * /latest and the build itself are also answered before the sign-in (clientUpdateOpenRouter):
 * a console that is suspended, still waiting, lost its key or runs a broken build can always
 * update out of it with the server's address alone. The build is the public client anyway.
 * The other routes sit behind the same sign-in as the rest of the server.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import express from "express";
import { clientStrings } from "../meta/client-strings.js";
import { pickEncoding } from "../helpers/json-compression.js";
import * as env from "../helpers/envs.js";
import { dataDir } from "../helpers/envs.js";
import * as integrations from "../security/integrations.js";
import { createClientRelease } from "../meta/client-release.js";
import { homebrewTarget, shortcutSpec } from "../retro/shortcut.js";
import { parseAssets } from "../meta/extract-providers/nro.js";
import { ClientBuildError, compareVersions, inspectNro } from "../meta/client-build.js";
import debug from "../debug.js";
import { mountClientLog } from "./client-log.js";
import { directUrl, forRequest } from "../security/download-links.js";
import { clientIp } from "../security/auth-guard.js";

export const CLIENT_NRO = path.join(dataDir, "client", "cookingfoil.nro");
export const GITHUB_NRO = path.join(dataDir, "client", "github", "cookingfoil.nro");
const PUBLISHED_DIR = path.join(dataDir, "client", ".published");
const PUBLISHED_NRO = path.join(PUBLISHED_DIR, "cookingfoil.nro");
const PUBLISHED_INFO = path.join(PUBLISHED_DIR, "build.json");
const MAX_BUILD_BYTES = 128 * 1024 * 1024;
const URL_PATH = "/api/client/cookingfoil.nro";

/** The client as a shortcut app: same title ID for every build. */
const clientApp = (info) => ({ id: "cookingfoil-client", name: "CookingFoil", publisher: "CookingFoil", target: homebrewTarget("cookingfoil.nro"), artKey: info.sha256 });

/** forwarder_title_id: the client's shortcut ID. */
const shortcutFields = (info) => ({ forwarder_title_id: shortcutSpec(clientApp(info))?.titleId ?? null });

let published; // { version, size, sha256, at, source } of the build being offered, or null
let rejected = null; // { code, message, size, at } for the manual file last turned down
let queue = Promise.resolve();
// Per source: the size + mtime last read, and what that file was ({ version, size, sha256 } or a problem).
const seen = { manual: { key: null, info: null }, github: { key: null, info: null } };

function loadPublished() {
  if (published !== undefined) return published;
  try {
    const saved = JSON.parse(fs.readFileSync(PUBLISHED_INFO, "utf8"));
    published = fs.statSync(PUBLISHED_NRO).size === saved.size ? saved : null;
  } catch {
    published = null;
  }
  return published;
}

async function publish(buf, version, source) {
  const info = { version, size: buf.length, sha256: crypto.createHash("sha256").update(buf).digest("hex"), at: Date.now(), source };
  await fs.promises.mkdir(PUBLISHED_DIR, { recursive: true });
  await fs.promises.writeFile(`${PUBLISHED_NRO}.tmp`, buf);
  await fs.promises.rename(`${PUBLISHED_NRO}.tmp`, PUBLISHED_NRO);
  await fs.promises.writeFile(`${PUBLISHED_INFO}.tmp`, JSON.stringify(info));
  await fs.promises.rename(`${PUBLISHED_INFO}.tmp`, PUBLISHED_INFO);
  published = info;
  if (source === "manual") rejected = null;
  debug.log("client update: published %s from %s (%d bytes, sha256 %s)", version, source, buf.length, info.sha256.slice(0, 12));
}

function reject(code, message, size) {
  rejected = { code, message, size, at: Date.now() };
  debug.error("client update: %s not offered (%s: %s); keeping %s", CLIENT_NRO, code, message, published?.version ?? "nothing");
}

/** Reads one source's file again if its size or mtime changed; seen[source].info is what it holds, or null. */
async function look(source, file) {
  let st;
  try {
    st = await fs.promises.stat(file);
  } catch {
    seen[source] = { key: null, info: null };
    return;
  }
  if (!st.isFile()) return;
  const key = `${st.size}\0${st.mtimeMs}`;
  if (key === seen[source].key) return;
  seen[source] = { key, info: null };
  if (st.size > MAX_BUILD_BYTES) return source === "manual" && reject("too-large", `${st.size} bytes`, st.size);
  // Check and hash the very bytes that may be served.
  const buf = await fs.promises.readFile(file);
  try {
    const { version } = inspectNro(buf);
    seen[source].info = { version, size: buf.length, sha256: crypto.createHash("sha256").update(buf).digest("hex"), source, file };
  } catch (err) {
    if (!(err instanceof ClientBuildError)) throw err;
    if (source === "manual") reject(err.code, err.message, buf.length);
  }
}

/** Of the builds there are, the one to offer: the newer version, the manual one on a tie. Pure. */
export function pickBuild(candidates) {
  return candidates.filter(Boolean).reduce((best, c) => {
    if (!best) return c;
    const order = compareVersions(c.version, best.version);
    return order > 0 || (order === 0 && c.source === "manual") ? c : best;
  }, null);
}

async function chooseNow() {
  await look("manual", CLIENT_NRO);
  const github = env.clientSource === "github";
  if (github) await look("github", GITHUB_NRO);
  const best = pickBuild([seen.manual.info, github ? seen.github.info : null]);
  if (!best) return;
  const before = loadPublished();
  if (before?.sha256 === best.sha256 && (before.source ?? "manual") === best.source) return;
  // A manual file older than the manual build offered before is an old one dropped in by mistake.
  if (best.source === "manual" && (before?.source ?? "manual") === "manual" && before && compareVersions(best.version, before.version) < 0) {
    if (rejected?.code !== "downgrade") reject("downgrade", `${best.version} is older than ${before.version}`, best.size);
    return;
  }
  const buf = await fs.promises.readFile(best.file);
  // The file changed after it was read: the next look reads it again.
  if (crypto.createHash("sha256").update(buf).digest("hex") !== best.sha256) {
    seen[best.source].key = null;
    return;
  }
  await publish(buf, best.version, best.source);
}

/**
 * Chooses the build to offer again if a file changed since last time.
 * One choice at a time: the minute loop, an upload and the release follower can
 * all ask at once, and an older read must never publish over a newer file.
 */
function choose() {
  const next = queue.then(() => chooseNow());
  queue = next.catch(() => {});
  return next;
}

const SIG_MAX_BYTES = 4096;
const SIG_RE = /^[0-9a-f]{128}$/i;
let sigSeen = null; // { key, value } of the signature file last read

/** The signature file's contents, read again only when its size or mtime changes; null when there is none or it is unreadable. */
function readSignature(file) {
  let st;
  try {
    st = fs.statSync(file);
  } catch {
    sigSeen = null;
    return null;
  }
  const key = `${file}\0${st.size}\0${st.mtimeMs}`;
  if (sigSeen?.key === key) return sigSeen.value;
  let value = null;
  try {
    if (st.isFile() && st.size <= SIG_MAX_BYTES) value = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    debug.error("client update: %s unreadable: %s", path.basename(file), err.message);
  }
  sigSeen = { key, value };
  return value;
}

/** The signature for build `p` from `sig` (the file's contents), or null unless version, size and sha256 all match. Pure. */
export function signatureFor(p, sig) {
  if (!p || !sig || typeof sig !== "object") return null;
  if (sig.version !== p.version || sig.size !== p.size || String(sig.sha256 ?? "").toLowerCase() !== p.sha256) return null;
  return typeof sig.signature === "string" && SIG_RE.test(sig.signature) ? sig.signature.toLowerCase() : null;
}

/** The build being offered, or null when none has passed the checks. */
export async function latestBuild() {
  await choose();
  const p = loadPublished();
  if (!p) return null;
  const signature = signatureFor(p, readSignature(`${CLIENT_NRO}.sig.json`));
  return { version: p.version, size: p.size, sha256: p.sha256, ...(signature ? { signature } : {}), url: URL_PATH };
}

/** Where the build being offered is kept (latestBuild says whether there is one). */
export const publishedNroPath = () => PUBLISHED_NRO;

/**
 * For the admin page: what is offered (with its source), the manual file turned
 * down last (null once a good one replaced it), and the version each source holds.
 */
export function clientBuildStatus() {
  const p = loadPublished();
  const brief = (i) => (i ? { version: i.version, size: i.size } : null);
  return {
    published: p ? { ...p, source: p.source ?? "manual" } : null,
    signed: Boolean(signatureFor(p, readSignature(`${CLIENT_NRO}.sig.json`))),
    rejected,
    mode: env.clientSource,
    manual: brief(seen.manual.info),
    github: brief(seen.github.info),
  };
}

const RECHECK_MS = 60_000;
const RELEASE_CHECK_MS = 30 * 60_000;

/** The GitHub release follower; one per process. It only runs in "github" mode. */
export const clientRelease = createClientRelease({
  repo: () => (env.clientSource === "github" ? env.clientReleaseRepo : ""),
  tag: () => env.clientReleaseTag,
  asset: () => env.clientReleaseAsset,
  dest: GITHUB_NRO,
  stateFile: path.join(dataDir, "client", "github", "release.json"),
  current: () => seen.github.info,
  // Choosing reads the fetched file again (its mtime changed), inside the one-at-a-time queue.
  publish: () => latestBuild(),
  token: () => integrations.get("github").token,
  maxBytes: MAX_BUILD_BYTES,
});

async function serveLatest(req, res, next) {
  try {
    const info = await latestBuild();
    res.set("Cache-Control", "no-store");
    if (!info) return res.status(404).json({ error: "no client build on this server" });
    const link = forRequest(req);
    res.json({ ...info, url: directUrl(info.url, link), ...shortcutFields(info) });
  } catch (err) {
    next(err);
  }
}

async function serveBuild(req, res, next) {
  try {
    const info = await latestBuild();
    if (!info) return res.status(404).json({ error: "no client build on this server" });
    res.set({ "Cache-Control": "no-cache", ETag: `"${info.sha256}"` });
    if (req.fresh) return res.status(304).end();
    res.type("application/octet-stream");
    res.attachment("cookingfoil.nro");
    res.sendFile(PUBLISHED_NRO, { etag: false, lastModified: false, acceptRanges: true });
  } catch (err) {
    next(err);
  }
}

// Before the sign-in the build is a few MB anyone may ask for, so each address gets a handful an hour.
const OPEN_BUILDS_PER_HOUR = 20;
const HOUR_MS = 60 * 60_000;

/** /latest and the build, mounted ahead of the sign-in; a key, even a suspended one, is not looked at. */
export function clientUpdateOpenRouter({ perHour = OPEN_BUILDS_PER_HOUR, now = Date.now } = {}) {
  const router = express.Router();
  const taken = new Map(); // ip → { since, count }
  router.get("/latest", serveLatest);
  router.get("/cookingfoil.nro", (req, res, next) => {
    if (req.fresh || req.get("Range")) return serveBuild(req, res, next);
    const ip = clientIp(req);
    const t = now();
    for (const [k, v] of taken) if (t - v.since >= HOUR_MS) taken.delete(k);
    const mine = taken.get(ip) ?? { since: t, count: 0 };
    if (mine.count >= perHour) {
      res.set("Retry-After", String(Math.ceil((mine.since + HOUR_MS - t) / 1000)));
      return res.status(429).json({ error: "too many client downloads from this address; try again later" });
    }
    taken.set(ip, { ...mine, count: mine.count + 1 });
    serveBuild(req, res, next);
  });
  return router;
}

export default function clientUpdateRouter() {
  const router = express.Router();
  // Look at a dropped-in build even before a console asks, so the admin page hears about a bad one.
  const check = () => latestBuild().catch((err) => debug.error("client update: %s", err.message));
  check();
  setInterval(check, RECHECK_MS).unref();
  // A release that keeps failing the same way is logged once, not every check.
  let lastError = null;
  const follow = () => clientRelease.check().then((s) => {
    const message = s.error?.message ?? null;
    if (message && message !== lastError) debug.error("client update: release: %s", message);
    lastError = message;
  }).catch((err) => debug.error("client update: release: %s", err.message));
  setTimeout(follow, 5_000).unref();
  setInterval(follow, RELEASE_CHECK_MS).unref();
  router.get("/strings", (req, res) => {
    const answer = clientStrings(String(req.query.lang ?? ""));
    if (!answer) return res.status(404).json({ error: "no strings for this language", code: "unknown-language" });
    res.set({ "Cache-Control": "private, no-cache", ETag: answer.etag, Vary: "Accept-Encoding" });
    if (req.fresh) return res.status(304).end();
    // Compressed once at start, so the reply keeps its Content-Length.
    const encoding = pickEncoding(req.get("Accept-Encoding"));
    if (encoding) res.set("Content-Encoding", encoding);
    res.type("application/json").send(encoding ? answer[encoding] : answer.json);
  });
  router.get("/latest", serveLatest);
  // The build's own icon, for the web page's download card.
  router.get("/icon", async (req, res, next) => {
    try {
      const info = await latestBuild();
      const icon = info ? (await parseAssets(PUBLISHED_NRO).catch(() => null))?.icon : null;
      if (!icon) return res.status(404).end();
      res.set({ "Cache-Control": "private, max-age=86400", ETag: `"icon-${info.sha256.slice(0, 16)}"` });
      if (req.fresh) return res.status(304).end();
      res.type(icon[0] === 0x89 ? "image/png" : "image/jpeg").send(icon);
    } catch (err) {
      next(err);
    }
  });
  router.get("/cookingfoil.nro", serveBuild);
  mountClientLog(router);
  return router;
}
