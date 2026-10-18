/**
 * Automation tokens (see security/api-tokens.js), from the admin page only:
 *
 *   GET  /admin/api/tokens               [{ id, owner, label, createdAt, lastUsedAt }]
 *   POST /admin/api/tokens   { label }   { id, token }   the token is shown this once
 *   POST /admin/api/tokens/:id/revoke
 *
 * A request made with a token cannot use these: tokens never mint tokens.
 */
import * as apiTokens from "../../security/api-tokens.js";
import { adminActor } from "../../security/admin-actor.js";
import debug from "../../debug.js";

export function mountApiTokensApi(router, requireSession) {
  const guarded = (handler) => (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store");
    if (req.apiToken) return res.status(403).json({ error: "토큰으로는 토큰을 다룰 수 없습니다" });
    try {
      handler(req, res);
    } catch (err) {
      if (!(err instanceof apiTokens.TokenError)) throw err;
      res.status(400).json({ error: err.message });
    }
  };

  router.get("/api/tokens", guarded((_req, res) => res.json({ tokens: apiTokens.list() })));

  router.post("/api/tokens", guarded((req, res) => {
    const actor = adminActor(req);
    if (!actor) return res.status(409).json({ error: "관리자 계정으로 로그인한 뒤에 만들 수 있습니다" });
    const owner = actor.kind === "google" ? `google:${actor.sub}` : actor.name;
    const made = apiTokens.create(owner, req.body?.label);
    debug.log("admin: automation token %s made for %s", made.id, owner);
    res.json(made);
  }));

  router.post("/api/tokens/:id/revoke", guarded((req, res) => {
    apiTokens.revoke(String(req.params.id));
    debug.log("admin: automation token %s revoked", req.params.id);
    res.json({ ok: true });
  }));
}
