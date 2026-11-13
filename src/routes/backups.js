/**
 * /api/backups: a console's own backups (backups/), for the account the console belongs to. Only consoles use
 * these addresses; the web and the admin do not. Off, every address answers 404 backups-off.
 *
 *   GET  /                 the account's units on this console's platform (ETag)
 *   GET  /unit?key=        a unit's versions with their manifests
 *   POST /begin            { key, manifest } → { upload, need, needSecrets }
 *   PUT  /upload/:id       ?path=&offset=  a file's bytes from offset (a secret whole, at offset 0)
 *   HEAD /upload/:id       ?path=          X-Received: how much of it the server holds
 *   POST /finish           { upload } → { key, version }
 *   GET  /file             ?key=&version=&path=  one file, with Range
 *   GET  /secret           ?key=&version=&path=  one secret file, to the account's Vita consoles only
 *   POST /remove           { key, version? }
 *
 * Secret files are named in no log, answer or record here: what is logged is how many.
 */
import express from "express";
import crypto from "node:crypto";
import { PLATFORMS } from "../platforms/index.js";
import { requestPlatform } from "../platforms/switch-only.js";
import { accountOfDevice } from "../backups/account.js";
import { parseUnitKey } from "../backups/manifest.js";
import * as store from "../backups/store.js";
import * as uploads from "../backups/uploads.js";
import { readSecret, SecretLostError } from "../backups/secrets.js";
import * as devices from "../security/store.js";
import debug from "../debug.js";

const { BackupError } = store;

const MESSAGES = {
  "backups-off": "backups are off on this server",
  device: "backups are a console's: sign in on a console",
  account: "this console belongs to no account",
  unit: "no such backup",
  manifest: "the manifest is not one this server takes",
  busy: "another upload of this unit is under way",
  quota: "this account's backups are full",
  offset: "the offset is not where the server is",
  path: "that path is not one this upload takes",
  size: "more bytes than the file has",
  mismatch: "some files did not arrive whole",
  upload: "no such upload",
  "secret-lost": "this secret no longer opens on this server; back it up again from the console",
};

function send(res, err) {
  if (!(err instanceof BackupError)) throw err;
  res.status(err.status).json({ error: MESSAGES[err.code] ?? err.code, code: err.code, ...err.extra });
}

const handle = (fn) => async (req, res, next) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (err instanceof BackupError) send(res, err);
    else next(err);
  }
};

// The console and its account, or a refusal: backups off, not a console, a console no account holds.
function who(req) {
  if (!store.backupsRoot()) throw new BackupError(404, "backups-off");
  const deviceKey = req.pairedDevice ?? req.sessionDevice;
  if (!deviceKey) throw new BackupError(403, "device");
  const account = accountOfDevice(deviceKey);
  if (!account) throw new BackupError(403, "account");
  return { deviceKey, accountId: account.id, platform: requestPlatform(req), label: devices.deviceLabel(deviceKey) };
}

const unitKey = (platform, key) => {
  const unit = parseUnitKey(platform, key);
  if (!unit) throw new BackupError(404, "unit");
  return unit.key;
};
const versionOf = (v) => (/^\d{1,9}$/.test(String(v)) ? Number(v) : null);

async function versionRecord(c, key, version) {
  const found = (await store.unitVersions(c.accountId, c.platform, key)).find((v) => v.version === version);
  if (!found) throw new BackupError(404, "unit");
  return found;
}

export default function backupsRouter() {
  const router = express.Router();
  const json = express.json({ limit: "64mb" });

  router.get("/", handle(async (req, res) => {
    const c = who(req);
    const units = PLATFORMS[c.platform]?.backupKinds.length ? await store.listUnits(c.accountId, c.platform) : [];
    const body = JSON.stringify({ units });
    const etag = `"${crypto.createHash("sha1").update(body).digest("base64url")}"`;
    res.set({ "Cache-Control": "private, no-cache", ETag: etag });
    if (req.get("if-none-match") === etag) return res.status(304).end();
    res.type("application/json").send(body);
  }));

  router.get("/unit", handle(async (req, res) => {
    const c = who(req);
    const key = unitKey(c.platform, req.query.key);
    const versions = await store.unitVersions(c.accountId, c.platform, key);
    if (!versions.length) throw new BackupError(404, "unit");
    res.set("Cache-Control", "private, no-cache").json({ key, versions });
  }));

  router.post("/begin", json, handle(async (req, res) => {
    const c = who(req);
    const key = parseUnitKey(c.platform, req.body?.key)?.key;
    if (!key) throw new BackupError(400, "manifest");
    if (req.body?.manifest?.secrets?.length && c.platform !== "vita") throw new BackupError(400, "manifest");
    const out = await uploads.begin({ accountId: c.accountId, platform: c.platform, key, manifest: req.body?.manifest, by: { label: c.label } });
    debug.log("backups: begin %s… %d files to send, %d secret files", c.deviceKey.slice(0, 12), out.need.length, out.needSecrets.length);
    res.json(out);
  }));

  const pathOf = (req) => {
    const file = req.query.path;
    if (typeof file !== "string" || !file) throw new BackupError(400, "path");
    return file;
  };

  router.head("/upload/:id", handle(async (req, res) => {
    const c = who(req);
    const n = await uploads.received({ accountId: c.accountId, platform: c.platform, id: req.params.id, file: pathOf(req) });
    res.set({ "X-Received": String(n), "Cache-Control": "no-store" }).status(200).end();
  }));

  router.put("/upload/:id", handle(async (req, res) => {
    const c = who(req);
    const offset = Number(req.query.offset ?? 0);
    if (!Number.isSafeInteger(offset) || offset < 0) throw new BackupError(409, "offset", { received: 0 });
    const received = await uploads.put({ accountId: c.accountId, platform: c.platform, id: req.params.id, file: pathOf(req), offset, req });
    res.set("Cache-Control", "no-store").json({ received });
  }));

  router.post("/finish", json, handle(async (req, res) => {
    const c = who(req);
    const out = await uploads.finish({ accountId: c.accountId, platform: c.platform, id: req.body?.upload });
    debug.log("backups: %s… made version %d", c.deviceKey.slice(0, 12), out.version);
    res.json(out);
  }));

  router.get("/file", handle(async (req, res) => {
    const c = who(req);
    const key = unitKey(c.platform, req.query.key);
    const version = versionOf(req.query.version);
    if (version == null) throw new BackupError(404, "unit");
    const rec = await versionRecord(c, key, version);
    const file = rec.manifest.files.find((f) => f.path === req.query.path);
    if (!file) throw new BackupError(404, "path");
    res.sendFile(store.blobPath(c.accountId, file.sha256), {
      etag: false, lastModified: false, dotfiles: "allow",
      headers: { ETag: `"${file.sha256}"`, "Content-Type": "application/octet-stream", "Cache-Control": "private, no-cache" },
    }, (err) => {
      if (err && !res.headersSent) send(res, new BackupError(404, "path"));
    });
  }));

  // Nothing but the account's own Vita is told a secret is there: every other caller hears there is no such unit.
  router.get("/secret", async (req, res, next) => {
    res.set("Cache-Control", "no-store");
    const unit = () => res.status(404).json({ error: MESSAGES.unit, code: "unit" });
    try {
      const deviceKey = req.pairedDevice ?? req.sessionDevice;
      if (!store.backupsRoot() || !deviceKey || requestPlatform(req) !== "vita") return unit();
      const account = accountOfDevice(deviceKey);
      const key = parseUnitKey("vita", req.query.key)?.key;
      const version = versionOf(req.query.version);
      if (!account || !key || version == null || typeof req.query.path !== "string") return unit();
      const rec = (await store.unitVersions(account.id, "vita", key)).find((v) => v.version === version);
      if (!rec?.manifest.secrets.some((f) => f.path === req.query.path)) return unit();
      let plain;
      try {
        plain = await readSecret(account.id, "vita", key, version, req.query.path);
      } catch (err) {
        if (!(err instanceof SecretLostError)) throw err;
        debug.log("backups: a secret file of %s… no longer opens", deviceKey.slice(0, 12));
        return res.status(410).json({ error: MESSAGES["secret-lost"], code: "secret-lost" });
      }
      if (!plain) return unit();
      res.set("Content-Type", "application/octet-stream").send(plain);
    } catch (err) {
      next(err);
    }
  });

  router.post("/remove", json, handle(async (req, res) => {
    const c = who(req);
    const key = unitKey(c.platform, req.body?.key);
    const version = req.body?.version == null ? null : versionOf(req.body.version);
    if (req.body?.version != null && version == null) throw new BackupError(404, "unit");
    if (!(await store.removeUnit(c.accountId, c.platform, key, version))) throw new BackupError(404, "unit");
    res.json({ ok: true });
  }));

  return router;
}
