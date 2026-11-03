/**
 * Passkeys for the admin page's own check (security/passkeys.js, scope "admin"):
 *
 *   POST /admin/passkey/options        WebAuthn options for the check, before the admin session
 *   POST /admin/passkey/login          { response } → the admin session, as a right code would
 *   GET  /admin/api/passkeys           the admin passkeys, and whether this address can use them
 *   POST /admin/api/passkeys/options   options to add one (admin session)
 *   POST /admin/api/passkeys/add       { response } → { ok, id }
 *   POST /admin/api/passkeys/remove    { id } → { ok }
 *
 * The router already admits admin accounts only and same-origin writes only. A wrong or unknown
 * passkey counts toward the same per-address lockout as a wrong code. Automation tokens are
 * refused the list and its changes (tokenBlocked() in routes/admin-page.js).
 */
import * as passkeys from "../../security/passkeys.js";
import * as store from "../../security/store.js";
import { clientIp, recordFailure } from "../../security/auth-guard.js";
import { trustedHere } from "../../security/net.js";
import { lockoutRetryAfter, retryAfter } from "../../security/retry-after.js";
import { adminOwner, issueSession } from "../../security/admin-session.js";
import debug from "../../debug.js";

function refusal(req, res, err) {
  if (!(err instanceof passkeys.PasskeyError)) throw err;
  res.append("Set-Cookie", passkeys.clearChallenge(req));
  res.status(err.code === "unknown" ? 401 : 400).json({ error: err.code });
}

export function mountPasskeysApi(router, { requireSession }) {
  const locked = (req, res) => {
    const ip = clientIp(req);
    if (trustedHere(req) || !store.isLocked(ip)) return false;
    retryAfter(res, lockoutRetryAfter(ip)).status(429).json({ error: "locked" });
    return true;
  };

  router.post("/passkey/options", async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (locked(req, res)) return;
    try {
      const { options, cookie } = await passkeys.startSignIn(req, "admin");
      res.append("Set-Cookie", cookie).json(options);
    } catch (err) {
      refusal(req, res, err);
    }
  });

  router.post("/passkey/login", async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (locked(req, res)) return;
    const ip = clientIp(req);
    try {
      await passkeys.finishSignIn(req, "admin", req.body?.response);
      store.clearFailure(ip);
      // issueSession sets the header outright, so the spent challenge is appended after it.
      issueSession(res);
      res.append("Set-Cookie", passkeys.clearChallenge(req));
      debug.log("admin login: passkey");
      res.json({ ok: true });
    } catch (err) {
      if (err instanceof passkeys.PasskeyError && !trustedHere(req)) recordFailure(ip, req);
      refusal(req, res, err);
    }
  });

  const guarded = (handler) => async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (!requireSession(req, res)) return;
    try {
      await handler(req, res);
    } catch (err) {
      refusal(req, res, err);
    }
  };

  router.get("/api/passkeys", guarded((req, res) => {
    res.json({ passkeys: passkeys.list("admin", null), available: Boolean(passkeys.relyingParty(req)), max: passkeys.MAX_PER_OWNER });
  }));

  router.post("/api/passkeys/options", guarded(async (req, res) => {
    const { options, cookie } = await passkeys.startAdd(req, "admin", null, adminOwner());
    res.append("Set-Cookie", cookie).json(options);
  }));

  router.post("/api/passkeys/add", guarded(async (req, res) => {
    const added = await passkeys.finishAdd(req, "admin", null, req.body?.response);
    res.append("Set-Cookie", passkeys.clearChallenge(req)).json({ ok: true, id: added.id });
  }));

  router.post("/api/passkeys/remove", guarded((req, res) => {
    const id = typeof req.body?.id === "string" ? req.body.id : "";
    if (!passkeys.remove("admin", null, id)) return res.status(404).json({ error: "unknown" });
    res.json({ ok: true });
  }));
}
