/**
 * The CookingFoil client updating itself.
 *
 *   GET /api/client/latest           { version, size, sha256, signature?, url, forwarder_url, forwarder_title_id, forwarder_size },
 *                                    or 404 when no build is there; url and forwarder_url are on the
 *                                    direct address for a client that asked for it (security/download-links.js)
 *   GET /api/client/cookingfoil.nro  the build itself (Content-Length, ETag = its sha256)
 *   GET /api/client/icon             the build's own icon (for the web page's download card)
 *   GET /api/client/forwarder        the client's own HOME-menu shortcut NSP, starting
 *                                    sdmc:/switch/cookingfoil/cookingfoil.nro (fixed title ID)
 *   POST /api/client/log             a console's error log (see client-log.js)
 *
 * A build is published by dropping it at <data dir>/client/cookingfoil.nro, or
 * uploading it on the admin page (admin/upload-api.js, kind "client")
 * (written elsewhere and moved in; a .tmp beside it is never read). Whenever its
 * size or mtime changes it is checked (meta/client-build.js: NRO header and size,
 * ASET, NACP, an x.y.z version not lower than the last one). A build that passes
 * is copied to client/.published/ with its facts, and that copy is what is
 * offered and served, so size and sha256 always describe the bytes sent. A build
 * that fails is logged and shown on the admin page, and the last good one stays. The forwarder
 * fields are null when this server can't build shortcuts (no prod.keys or
 * hacBrewPack); forwarder_size is null until the NSP is built in the background.
 *
 * The build's signature is made where the build is (never on this server) and
 * dropped beside it as cookingfoil.nro.sig.json:
 *   { "version", "size", "sha256", "signature": <128 hex, Ed25519> }
 * It is optional: it rides on /latest only while its version, size and sha256
 * are the build's being offered, and a build without one is offered all the
 * same. The server never checks or makes signatures and holds no key.
 * Every route sits behind the same sign-in as the rest of the server.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import express from "express";
import { dataDir, keysDir } from "../helpers/envs.js";
import { ensureForwarder, forwarderPath, forwarderSpec, forwardersAvailable, homebrewTarget } from "../retro/forwarder.js";
import { addForwarderSource } from "../tasks/forwarder-schedule.js";
import { parseAssets } from "../meta/extract-providers/nro.js";
import { ClientBuildError, compareVersions, inspectNro } from "../meta/client-build.js";
import debug from "../debug.js";
import { mountClientLog } from "./client-log.js";
import { directUrl, forRequest } from "../security/download-links.js";

export const CLIENT_NRO = path.join(dataDir, "client", "cookingfoil.nro");
const PUBLISHED_DIR = path.join(dataDir, "client", ".published");
const PUBLISHED_NRO = path.join(PUBLISHED_DIR, "cookingfoil.nro");
const PUBLISHED_INFO = path.join(PUBLISHED_DIR, "build.json");
const MAX_BUILD_BYTES = 128 * 1024 * 1024;
const URL_PATH = "/api/client/cookingfoil.nro";

const FORWARDER_DIR = path.join(dataDir, "client-forwarder");
const NO_FORWARDER = { forwarder_url: null, forwarder_title_id: null, forwarder_size: null };

/** The client as a forwarder app: same title ID for every build, rebuilt when the build changes. */
const clientApp = (info) => ({ id: "cookingfoil-client", name: "CookingFoil", publisher: "CookingFoil", target: homebrewTarget("cookingfoil.nro"), artKey: info.sha256 });

async function withIcon(info) {
  return { ...clientApp(info), icon: (await parseAssets(PUBLISHED_NRO).catch(() => null))?.icon ?? null };
}

/** forwarder_url, forwarder_title_id, forwarder_size (null until the first download builds it). */
async function forwarderFields(info) {
  if (!forwardersAvailable(keysDir)) return NO_FORWARDER;
  const spec = forwarderSpec(clientApp(info));
  if (!spec) return NO_FORWARDER;
  let size = null;
  const nsp = forwarderPath(FORWARDER_DIR, "cookingfoil-client", spec);
  try {
    size = fs.statSync(nsp).size;
    if (size === 0) {
      // An empty shortcut is never offered: drop it and build it again.
      debug.error("client update: shortcut %s is empty, rebuilding", path.basename(nsp));
      fs.rmSync(nsp, { force: true });
      throw new Error("rebuild");
    }
  } catch {
    size = null;
  }
  return { forwarder_url: "/api/client/forwarder", forwarder_title_id: spec.titleId, forwarder_size: size };
}

let published; // { version, size, sha256, at } of the build being offered, or null
// The nightly pass builds the published client's own shortcut when no one downloaded it yet.
addForwarderSource("client", {
  dir: FORWARDER_DIR,
  keysDir,
  apps: async () => {
    const info = loadPublished();
    return info ? [await withIcon(info)] : [];
  },
});
let rejected = null; // { code, message, size, at } for the file last turned down
let lastKey = null; // size + mtime of the file last examined
let inFlight = null;

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

async function publish(buf, version) {
  const info = { version, size: buf.length, sha256: crypto.createHash("sha256").update(buf).digest("hex"), at: Date.now() };
  await fs.promises.mkdir(PUBLISHED_DIR, { recursive: true });
  await fs.promises.writeFile(`${PUBLISHED_NRO}.tmp`, buf);
  await fs.promises.rename(`${PUBLISHED_NRO}.tmp`, PUBLISHED_NRO);
  await fs.promises.writeFile(`${PUBLISHED_INFO}.tmp`, JSON.stringify(info));
  await fs.promises.rename(`${PUBLISHED_INFO}.tmp`, PUBLISHED_INFO);
  published = info;
  rejected = null;
  debug.log("client update: published %s (%d bytes, sha256 %s)", version, buf.length, info.sha256.slice(0, 12));
}

function reject(code, message, size) {
  rejected = { code, message, size, at: Date.now() };
  debug.error("client update: %s not offered (%s: %s); keeping %s", CLIENT_NRO, code, message, published?.version ?? "nothing");
}

/** Checks the dropped-in build if it changed since last time, publishing or rejecting it. */
async function examine(file) {
  let st;
  try {
    st = await fs.promises.stat(file);
  } catch {
    return;
  }
  if (!st.isFile()) return;
  const key = `${st.size}\0${st.mtimeMs}`;
  if (key === lastKey) return;
  if (inFlight?.key === key) return inFlight.promise;
  const promise = (async () => {
    lastKey = key;
    if (st.size > MAX_BUILD_BYTES) return reject("too-large", `${st.size} bytes`, st.size);
    // Check and hash the very bytes that will be served.
    const buf = await fs.promises.readFile(file);
    let version;
    try {
      ({ version } = inspectNro(buf));
    } catch (err) {
      if (!(err instanceof ClientBuildError)) throw err;
      return reject(err.code, err.message, buf.length);
    }
    const before = loadPublished();
    if (before && compareVersions(version, before.version) < 0) return reject("downgrade", `${version} is older than ${before.version}`, buf.length);
    if (before?.version === version && before.size === buf.length && crypto.createHash("sha256").update(buf).digest("hex") === before.sha256) return;
    await publish(buf, version);
  })().finally(() => { inFlight = null; });
  inFlight = { key, promise };
  return promise;
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
export async function latestBuild(file = CLIENT_NRO) {
  await examine(file);
  const p = loadPublished();
  if (!p) return null;
  const signature = signatureFor(p, readSignature(`${file}.sig.json`));
  return { version: p.version, size: p.size, sha256: p.sha256, ...(signature ? { signature } : {}), url: URL_PATH };
}

/** Where the build being offered is kept (latestBuild says whether there is one). */
export const publishedNroPath = () => PUBLISHED_NRO;

/** For the admin page: what is offered, and the last file turned down (null once a good one replaced it). */
export function clientBuildStatus() {
  const p = loadPublished();
  return { published: p, signed: Boolean(signatureFor(p, readSignature(`${CLIENT_NRO}.sig.json`))), rejected };
}

const RECHECK_MS = 60_000;

export default function clientUpdateRouter() {
  const router = express.Router();
  // Look at a dropped-in build even before a console asks, so the admin page hears about a bad one.
  const check = () => latestBuild().catch((err) => debug.error("client update: %s", err.message));
  check();
  setInterval(check, RECHECK_MS).unref();
  router.get("/latest", async (req, res, next) => {
    try {
      const info = await latestBuild();
      res.set("Cache-Control", "no-store");
      if (!info) return res.status(404).json({ error: "no client build on this server" });
      const link = forRequest(req);
      const { forwarder_url: forwarderUrl, ...forwarder } = await forwarderFields(info);
      res.json({
        ...info,
        url: directUrl(info.url, link),
        forwarder_url: directUrl(forwarderUrl, link),
        ...forwarder,
      });
    } catch (err) {
      next(err);
    }
  });
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
  router.get("/cookingfoil.nro", async (req, res, next) => {
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
  });
  router.get("/forwarder", async (req, res, next) => {
    try {
      const info = await latestBuild();
      if (!info || !forwardersAvailable(keysDir)) return res.status(404).json({ error: "no shortcut on this server" });
      const built = await ensureForwarder(FORWARDER_DIR, await withIcon(info), keysDir);
      if (!built) return res.status(404).json({ error: "no shortcut on this server" });
      res.attachment("CookingFoil.nsp");
      res.set({ "Cache-Control": "no-cache", "X-Forwarder-Title-Id": built.spec.titleId });
      res.sendFile(built.path, { etag: true, lastModified: false });
    } catch (err) {
      debug.error("client update: shortcut failed: %s", err.message);
      next(err);
    }
  });
  mountClientLog(router);
  return router;
}
