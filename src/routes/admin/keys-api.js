/**
 * prod.keys from the admin page's settings tab (admin session; the router refuses another site's Origin):
 *
 *   PUT    /admin/api/keys  { text }  install the file's text → { ok, keys: S }
 *          400 { error, reason }: "format" (only "name = hex" lines, blanks and #/; comments, with
 *          key_area_key_application_* or master_key_* entries), "no-header-key", "too-large" (over 64 KB)
 *   DELETE /admin/api/keys            remove the uploaded copy → { ok, removed, keys: S }; a mounted file stays
 *
 * S is security/prod-keys.js status(), also on GET /admin/api/server-settings as `keys`.
 * Automation tokens cannot change keys (TOKEN_BLOCKED_RE).
 */
import * as prodKeys from "../../security/prod-keys.js";
import { adminApprover } from "../../security/admin-actor.js";
import { keysChanged } from "../../meta/keys-refresh.js";
import { apiWord } from "./api-words.js";
import { actorOf } from "../../library/trash-service.js";
import { ChunkError, takeFile } from "../../meta/upload-chunks.js";

const REFUSED = {
  format: "keys.format",
  "no-header-key": "keys.noHeaderKey",
  "too-large": "keys.tooLarge",
};

export function mountKeysApi(router, requireSession) {
  router.put("/api/keys", async (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store");
    try {
      // The file may have gone up in pieces first (meta/upload-chunks.js); the request then names it.
      const id = req.get("X-Chunk-Id");
      const text = id ? (await takeFile(id, { limit: 1024 * 1024 })).bytes.toString("utf8") : req.body?.text;
      const keys = prodKeys.install(text, { actor: adminApprover(req), via: "dashboard" });
      keysChanged();
      res.json({ ok: true, keys });
    } catch (err) {
      if (err instanceof ChunkError) return res.status(err.status).json({ error: apiWord(req, err.key, err.vars), code: err.key });
      if (!(err instanceof prodKeys.KeysError)) throw err;
      res.status(400).json({ error: REFUSED[err.reason] ? apiWord(req, REFUSED[err.reason]) : err.message, reason: err.reason });
    }
  });

  router.delete("/api/keys", async (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store");
    let removed;
    try {
      removed = await prodKeys.remove({ actor: adminApprover(req), via: "dashboard", by: actorOf(req) });
    } catch (err) {
      res.status(err.status ?? 500).json({ error: err.message, code: err.code ?? null });
      return;
    }
    if (removed) keysChanged();
    res.json({ ok: true, removed, keys: prodKeys.status() });
  });
}
