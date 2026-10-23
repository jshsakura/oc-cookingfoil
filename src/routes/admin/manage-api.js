/**
 * /admin/api — account and library management.
 *
 * Every route needs a valid admin session. Changes additionally refuse a
 * cross-origin Origin header; the session cookie is SameSite=Strict already,
 * so this is a second lock on the same door.
 *
 * Removing an account, turning it off or giving it a new password revokes the
 * consoles and enrollment tokens it left (account-access.js).
 */
import * as users from "../../security/users.js";
import * as store from "../../security/store.js";
import { revokeOwnedBy } from "../../security/account-access.js";
import * as shopCache from "../../meta/shop-cache.js";
import * as titledbStore from "../../meta/titledb-store.js";
import * as featured from "../../meta/featured.js";
import { libraryGames, findLibraryGames } from "../../meta/library-games.js";
import { resolveOrigin } from "../../helpers/origin.js";
import {
  publicBaseUrl, devicePairing, uploadsEnabled, extractIcons, langPriority,
} from "../../helpers/envs.js";
import pkg from "../../package.js";
import debug from "../../debug.js";
import { isSelf } from "../../security/admin-actor.js";
import * as envs from "../../helpers/envs.js";
import { apiWord } from "./api-words.js";
import { isMetaCode, metaErrorText } from "../../meta/meta-messages.js";
import { requestLang } from "../../meta/langs.js";

const USER_ERROR_STATUS = {
  "invalid-name": 400, "weak-password": 400, "invalid-role": 400, "not-found": 404, exists: 409, "last-user": 409,
  "last-admin": 409, self: 409,
  "invalid-featured": 400,
};

function sameOrigin(req, res) {
  const origin = req.get("Origin");
  if (!origin || origin === resolveOrigin(req, publicBaseUrl)) return true;
  res.status(403).json({ error: "origin mismatch" });
  return false;
}

class SelfError extends Error {
  constructor() {
    super("You can't disable, demote or remove the account you are signed in with.");
    this.code = "self";
  }
}

/** An admin never locks themselves out (the one exception: emptying the server, which opens it). */
function notSelf(req, name, { emptying = false } = {}) {
  if (isSelf(req, "password", name) && !emptying) throw new SelfError();
}

function userError(req, res, err) {
  const status = USER_ERROR_STATUS[err.code];
  // A meta module's refusal (featured.js) carries its message key: said in the request's language, the key as `code`.
  if (status && isMetaCode(err.key)) return res.status(status).json({ error: err.code, message: metaErrorText(requestLang(req), err), code: err.key });
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
    try { handler(req, res); } catch (err) { userError(req, res, err); }
  };

  router.get("/api/users", (req, res) => {
    if (!guard(req, res)) return;
    res.set("Cache-Control", "no-store");
    res.json({ users: users.list() });
  });

  // The plaintext password is returned exactly once, so the operator can hand
  // it to the person; only its hash is kept.
  router.post("/api/users", change((req, res) => {
    const created = users.add(String(req.body?.name ?? "").trim(), req.body?.password || undefined, req.body?.role === "admin" ? "admin" : "user");
    debug.log("admin: added user %s", created.name);
    res.status(201).json(created);
  }));

  router.post("/api/users/:name/password", change((req, res) => {
    const updated = users.setPassword(req.params.name, req.body?.password || undefined);
    revokeOwnedBy(updated.name);
    debug.log("admin: reset password for %s", updated.name);
    res.json(updated);
  }));

  router.post("/api/users/:name/role", change((req, res) => {
    const role = String(req.body?.role ?? "");
    if (role !== "admin") notSelf(req, req.params.name);
    users.setRole(req.params.name, role);
    debug.log("admin: %s is now %s", req.params.name, role);
    res.json({ ok: true });
  }));

  router.post("/api/users/:name/enabled", change((req, res) => {
    if (req.body?.enabled !== true) notSelf(req, req.params.name);
    users.setEnabled(req.params.name, req.body?.enabled === true);
    if (req.body?.enabled !== true) revokeOwnedBy(req.params.name);
    debug.log("admin: %s user %s", req.body?.enabled === true ? "enabled" : "disabled", req.params.name);
    res.json({ ok: true });
  }));

  router.delete("/api/users/:name", change((req, res) => {
    // Google-only with no password account left would read as "no accounts": the server would open up.
    if (!envs.passwordLogin && users.list().length === 1 && users.list()[0].name === req.params.name) {
      return res.status(409).json({ error: "Google 로 로그인하는 동안에는 마지막 비밀번호 계정을 지울 수 없습니다. 지우면 서버가 비밀번호 없이 열립니다." });
    }
    notSelf(req, req.params.name, { emptying: req.query.allowEmpty === "1" && users.list().length === 1 });
    users.remove(req.params.name, { allowEmpty: req.query.allowEmpty === "1" });
    store.forgetLogins(req.params.name);
    revokeOwnedBy(req.params.name);
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
      scan: cache.scan,
      now: Date.now(),
      titledb: titledbStore.status(),
      settings: { devicePairing, uploadsEnabled, extractIcons, langPriority, publicBaseUrl: publicBaseUrl || null },
    });
  });

  router.get("/api/featured", async (req, res) => {
    if (!guard(req, res)) return;
    res.set("Cache-Control", "no-store");
    // Names for the games already in a row; finding more goes through /api/games/search.
    const collections = featured.list();
    const inRows = new Set(collections.flatMap((c) => c.titleIds));
    res.json({ collections, candidates: (await libraryGames()).filter((g) => inRows.has(g.titleId)) });
  });

  // The admin's game pickers and the home picks list: library games by part of any name, Korean
  // initials or title ID, a page at a time, by name or newest first.
  router.get("/api/games/search", async (req, res) => {
    if (!guard(req, res)) return;
    res.set("Cache-Control", "no-store");
    try {
      const { q, limit, offset, sort } = req.query;
      res.json(await findLibraryGames(String(q ?? ""), { limit, offset, sort: String(sort ?? "name") }));
    } catch (err) {
      debug.error("admin: game search: %s", err.message);
      res.status(500).json({ error: apiWord(req, "games.searchFailed") });
    }
  });

  router.put("/api/featured", change((req, res) => {
    const collections = featured.replace(req.body?.collections);
    debug.log("admin: saved %d featured collection(s)", collections.length);
    res.json({ collections });
  }));

  router.post("/api/library/rescan", change((req, res) => {
    // Pressed again while one waits or runs: that read already covers it.
    const { scan } = shopCache.stats();
    const already = scan.fullPending;
    if (!already) shopCache.invalidate({ rescan: true });
    debug.log("admin: library rescan requested%s", already ? " (one already pending)" : "");
    res.json({ ok: true, already, requestedAt: Date.now() });
  }));
}
