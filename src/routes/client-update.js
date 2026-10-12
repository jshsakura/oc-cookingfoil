/**
 * The CookingFoil client updating itself.
 *
 *   GET /api/client/latest           { version, size, sha256, url }, or 404 when no build is there
 *   GET /api/client/cookingfoil.nro  the build itself (Content-Length, ETag = its sha256)
 *   POST /api/client/log             a console's error log (see client-log.js)
 *
 * A build is published by dropping it at <data dir>/client/cookingfoil.nro.
 * version is the NACP display version inside the NRO; it and the sha256 are
 * worked out again whenever the file's size or mtime changes. Both routes sit
 * behind the same sign-in as the rest of the server.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import express from "express";
import { dataDir } from "../helpers/envs.js";
import { parseAssets } from "../meta/extract-providers/nro.js";
import { decodeNacp } from "../meta/nacp-decode.js";
import debug from "../debug.js";
import { mountClientLog } from "./client-log.js";

export const CLIENT_NRO = path.join(dataDir, "client", "cookingfoil.nro");
const URL_PATH = "/api/client/cookingfoil.nro";

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
      res.json(info);
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
  mountClientLog(router);
  return router;
}
