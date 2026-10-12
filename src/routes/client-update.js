/**
 * The CookingFoil client updating itself.
 *
 *   GET /api/client/latest           { version, size, sha256, url, forwarder_url, forwarder_title_id, forwarder_size },
 *                                    or 404 when no build is there
 *   GET /api/client/cookingfoil.nro  the build itself (Content-Length, ETag = its sha256)
 *   GET /api/client/forwarder        the client's own HOME-menu shortcut NSP, starting
 *                                    sdmc:/switch/cookingfoil/cookingfoil.nro (fixed title ID)
 *   POST /api/client/log             a console's error log (see client-log.js)
 *
 * A build is published by dropping it at <data dir>/client/cookingfoil.nro.
 * version is the NACP display version inside the NRO; it and the sha256 are
 * worked out again whenever the file's size or mtime changes. The forwarder
 * fields are null when this server can't build shortcuts (no prod.keys or
 * hacBrewPack); forwarder_size is null until the NSP is built in the background.
 * Every route sits behind the same sign-in as the rest of the server.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import express from "express";
import { dataDir, keysDir } from "../helpers/envs.js";
import { ensureForwarder, forwarderPath, forwarderSpec, forwardersAvailable, homebrewTarget, prewarmForwarders } from "../retro/forwarder.js";
import { parseAssets } from "../meta/extract-providers/nro.js";
import { decodeNacp } from "../meta/nacp-decode.js";
import debug from "../debug.js";
import { mountClientLog } from "./client-log.js";

export const CLIENT_NRO = path.join(dataDir, "client", "cookingfoil.nro");
const URL_PATH = "/api/client/cookingfoil.nro";

const FORWARDER_DIR = path.join(dataDir, "client-forwarder");
const NO_FORWARDER = { forwarder_url: null, forwarder_title_id: null, forwarder_size: null };

/** The client as a forwarder app: same title ID for every build, rebuilt when the build changes. */
const clientApp = (info) => ({ id: "cookingfoil-client", name: "CookingFoil", publisher: "CookingFoil", target: homebrewTarget("cookingfoil.nro"), artKey: info.sha256 });

async function withIcon(info) {
  return { ...clientApp(info), icon: (await parseAssets(CLIENT_NRO).catch(() => null))?.icon ?? null };
}

/** forwarder_url, forwarder_title_id, forwarder_size; starts a build when it's missing. */
async function forwarderFields(info) {
  if (!forwardersAvailable(keysDir)) return NO_FORWARDER;
  const spec = forwarderSpec(clientApp(info));
  if (!spec) return NO_FORWARDER;
  let size = null;
  try {
    size = fs.statSync(forwarderPath(FORWARDER_DIR, "cookingfoil-client", spec)).size;
  } catch {
    // Build it (and drop the previous build's) in the background.
    withIcon(info).then((app) => prewarmForwarders(FORWARDER_DIR, [app], keysDir)).catch((err) => debug.error("client update: shortcut: %s", err.message));
  }
  return { forwarder_url: "/api/client/forwarder", forwarder_title_id: spec.titleId, forwarder_size: size };
}

let cache = null; // { key, info } for the file last read
let inFlight = null;

function sha256Of(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash("sha256");
    fs.createReadStream(file).on("data", (d) => h.update(d)).on("error", reject).on("end", () => resolve(h.digest("hex")));
  });
}

/** The published build's facts, or null when there is none (or it isn't an NRO). */
export async function latestBuild(file = CLIENT_NRO) {
  let st;
  try {
    st = await fs.promises.stat(file);
  } catch {
    return null;
  }
  if (!st.isFile()) return null;
  const key = `${file}\0${st.size}\0${st.mtimeMs}`;
  if (cache?.key === key) return cache.info;
  if (inFlight?.key === key) return inFlight.promise;
  const promise = (async () => {
    const assets = await parseAssets(file);
    const version = assets?.nacp ? decodeNacp(assets.nacp).version : null;
    if (!version) {
      debug.error("client update: %s has no NACP display version", file);
      return null;
    }
    const info = { version, size: st.size, sha256: await sha256Of(file), url: URL_PATH };
    cache = { key, info };
    debug.log("client update: build %s (%d bytes)", version, st.size);
    return info;
  })().finally(() => { inFlight = null; });
  inFlight = { key, promise };
  return promise;
}

export default function clientUpdateRouter() {
  const router = express.Router();
  router.get("/latest", async (req, res, next) => {
    try {
      const info = await latestBuild();
      res.set("Cache-Control", "no-store");
      if (!info) return res.status(404).json({ error: "no client build on this server" });
      res.json({ ...info, ...(await forwarderFields(info)) });
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
      res.sendFile(CLIENT_NRO, { etag: false, lastModified: false, acceptRanges: true });
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
