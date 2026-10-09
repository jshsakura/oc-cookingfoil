/**
 * /admin/api — account and library management.
 *
 * Every route needs a valid admin session. Changes additionally refuse a
 * cross-origin Origin header; the session cookie is SameSite=Strict already,
 * so this is a second lock on the same door.
 */
import * as users from "../../security/users.js";
import * as shopCache from "../../meta/shop-cache.js";
import * as titledbStore from "../../meta/titledb-store.js";
import * as featured from "../../meta/featured.js";
import { resolveOrigin } from "../../helpers/origin.js";
import {
  publicBaseUrl, devicePairing, uploadsEnabled, extractIcons, langPriority,
} from "../../helpers/envs.js";
import pkg from "../../package.js";
import debug from "../../debug.js";

const USER_ERROR_STATUS = {
  "invalid-name": 400, "weak-password": 400, "not-found": 404, exists: 409, "last-user": 409,
  "invalid-featured": 400,
};
const FILE_NAME_TAIL_RE = /\s*\[[0-9A-F]{16}\]\[v\d+\]$/i;

// Base games in the library, for picking featured titles: [{ titleId, name }].
async function baseCandidates() {
  const index = await shopCache.get();
  const seen = new Map();
  for (const file of index?.files ?? []) {
    if (file.kind !== "base" || !file.baseTitleId || seen.has(file.baseTitleId)) continue;
    seen.set(file.baseTitleId, String(file.name ?? "").replace(FILE_NAME_TAIL_RE, ""));
  }
  return [...seen].map(([titleId, name]) => ({ titleId, name }))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

function sameOrigin(req, res) {
  const origin = req.get("Origin");
  if (!origin || origin === resolveOrigin(req, publicBaseUrl)) return true;
  res.status(403).json({ error: "origin mismatch" });
  return false;
}

function userError(res, err) {
  const status = USER_ERROR_STATUS[err.code];
  if (status) return res.status(status).json({ error: err.code, message: err.message });
  // Disk or unexpected failures: log the detail, keep it out of the response.
  debug.error("admin: account change failed: %s", err.message);
  res.status(500).json({ error: "save-failed", message: "Could not save the change." });
}

/** Mount on the /admin router; `guard(req, res)` enforces the 2FA session. */
export function mountManageApi(router, guard) {
  const change = (handler) => (req, res) => {
    if (!guard(req, res) || !sameOrigin(req, res)) return;
    res.set("Cache-Control", "no-store");
    try { handler(req, res); } catch (err) { userError(res, err); }
  };

  router.get("/api/users", (req, res) => {
    if (!guard(req, res)) return;
    res.set("Cache-Control", "no-store");
    res.json({ users: users.list() });
  });

  // The plaintext password is returned exactly once, so the operator can hand
  // it to the person; only its hash is kept.
  router.post("/api/users", change((req, res) => {
    const created = users.add(String(req.body?.name ?? "").trim(), req.body?.password || undefined);
    debug.log("admin: added user %s", created.name);
    res.status(201).json(created);
  }));

  router.post("/api/users/:name/password", change((req, res) => {
    const updated = users.setPassword(req.params.name, req.body?.password || undefined);
    debug.log("admin: reset password for %s", updated.name);
    res.json(updated);
  }));

  router.post("/api/users/:name/enabled", change((req, res) => {
    users.setEnabled(req.params.name, req.body?.enabled === true);
    debug.log("admin: %s user %s", req.body?.enabled === true ? "enabled" : "disabled", req.params.name);
    res.json({ ok: true });
  }));

  router.delete("/api/users/:name", change((req, res) => {
    users.remove(req.params.name, { allowEmpty: req.query.allowEmpty === "1" });
    debug.log("admin: removed user %s", req.params.name);
    res.json({ ok: true });
  }));

  router.get("/api/library", (req, res) => {
    if (!guard(req, res)) return;
    const cache = shopCache.stats();
    res.set("Cache-Control", "no-store");
    res.json({
      version: pkg.version,
      uptime: Math.round(process.uptime()),
      origin: resolveOrigin(req, publicBaseUrl) || null,
      files: cache.files,
      cached: cache.cached,
      buildCount: cache.buildCount,
      lastBuildMs: cache.lastBuildMs,
      titledb: titledbStore.status(),
      settings: { devicePairing, uploadsEnabled, extractIcons, langPriority, publicBaseUrl: publicBaseUrl || null },
    });
  });

  router.get("/api/featured", async (req, res) => {
    if (!guard(req, res)) return;
    res.set("Cache-Control", "no-store");
    res.json({ collections: featured.list(), candidates: await baseCandidates() });
  });

  router.put("/api/featured", change((req, res) => {
    const collections = featured.replace(req.body?.collections);
    debug.log("admin: saved %d featured collection(s)", collections.length);
    res.json({ collections });
  }));

  router.post("/api/library/rescan", change((req, res) => {
    shopCache.invalidate({ rescan: true });
    debug.log("admin: library rescan requested");
    res.json({ ok: true });
  }));
}
