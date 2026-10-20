/**
 * prod.keys from the admin page's settings tab (admin session; the router refuses another site's Origin):
 *
 *   PUT    /admin/api/keys  { text }  install the file's text → { ok, keys: S }; 400 { error, reason } as in routes/admin-keys.js
 *   DELETE /admin/api/keys            remove the uploaded copy → { ok, removed, keys: S }; a mounted file stays
 *
 * S is security/prod-keys.js status(), also on GET /admin/api/server-settings as `keys`.
 * Automation tokens cannot change keys (TOKEN_BLOCKED_RE).
 */
import * as prodKeys from "../../security/prod-keys.js";
import { adminApprover } from "../../security/admin-actor.js";
import { keysChanged } from "../../meta/keys-refresh.js";

const REFUSED = {
  format: "prod.keys 형식이 아닙니다. 기기에서 덤프한 prod.keys 파일을 그대로 올립니다.",
  "no-header-key": "header_key 가 없습니다. 기기에서 덤프한 prod.keys 전체를 올립니다.",
  "too-large": "prod.keys 는 64 KB 를 넘을 수 없습니다.",
};

export function mountKeysApi(router, requireSession) {
  router.put("/api/keys", (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store");
    try {
      const keys = prodKeys.install(req.body?.text, { actor: adminApprover(req), via: "dashboard" });
      keysChanged();
      res.json({ ok: true, keys });
    } catch (err) {
      if (!(err instanceof prodKeys.KeysError)) throw err;
      res.status(400).json({ error: REFUSED[err.reason], reason: err.reason });
    }
  });

  router.delete("/api/keys", (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store");
    const removed = prodKeys.remove({ actor: adminApprover(req), via: "dashboard" });
    if (removed) keysChanged();
    res.json({ ok: true, removed, keys: prodKeys.status() });
  });
}
