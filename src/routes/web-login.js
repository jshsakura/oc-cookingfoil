/**
 * The web sign-in and the phone's device approval. Mounted outside the library's
 * sign-in wall: these are the pages a browser lands on before it has a session.
 *
 *   GET  /login?next=               ID and password form (plus a Google button when Google sign-in is on)
 *   POST /login                     form: username, password, csrf, next → session cookie, then `next`
 *   GET  /auth/me                   { user, kind, admin, csrf } for the signed-in browser, or 401
 *   POST /auth/logout               X-CSRF-Token
 *   GET  /auth/google/start?next=   off to Google
 *   GET  /auth/google/callback      back from Google
 *   GET  /device                    type a console's 8-character code
 *   GET  /pair/<token>              what a console's QR opens: one button to approve it
 *   GET  /admin/pair/<token>        the same (`?admin=1` keeps the admin's own page)
 *   POST /auth/device/approve       { token | code, label? } + X-CSRF-Token → { ok: true }
 *   POST /auth/passkey/options      X-CSRF-Token → WebAuthn sign-in options (security/passkeys.js)
 *   POST /auth/passkey/login        { response, next } + X-CSRF-Token → { ok, next }
 *   GET  /auth/passkeys             the signed-in account's passkeys
 *   POST /auth/passkeys/options     X-CSRF-Token → options to add one for the signed-in account
 *   POST /auth/passkeys/add         { response } + X-CSRF-Token → { ok, id }
 *   POST /auth/passkeys/remove      { id } + X-CSRF-Token → { ok }
 *
 * Wrong passwords count toward the same per-IP lockout as pairing sign-ins.
 * Consoles never sign in here: they use their device key and access key.
 */
import express from "express";

import * as accounts from "../security/google-accounts.js";
import * as users from "../security/users.js";
import * as store from "../security/store.js";
import { lockNotice, lockoutRetryAfter, retryAfter } from "../security/retry-after.js";
import * as googleConfig from "../security/google-config.js";
import {
  OAUTH_COOKIE, OAUTH_MS, clearUserSession, cookieLine, cookies, csrfOk, csrfToken,
  issuePasskeySession, issuePasswordSession, issueUserSession, seal, sessionAccount, unseal, webUser,
} from "../security/user-session.js";
import * as passkeys from "../security/passkeys.js";
import { CALLBACK_PATH, authUrl, checkClaims, exchangeCode, newAttempt, safeNext } from "../security/google-oauth.js";
import { clientIp, recordFailure } from "../security/auth-guard.js";
import { trustedHere } from "../security/net.js";
import { readPairLink, findPairLinkByCode } from "../security/pairing-link.js";
import { approvePairLink, pairLinkView } from "../security/pairing-approve.js";
import { deviceLimitRefusal } from "../security/device-limit.js";
import { devicePairing, googleRedirectBase, publicBaseUrl } from "../helpers/envs.js";
import * as integrations from "../security/integrations.js";
import { resolveOrigin } from "../helpers/origin.js";
import { requestLang } from "../meta/langs.js";
import { devicePage, loginPage } from "./login-page.js";
import debug from "../debug.js";
import { gravatarUrl } from "../helpers/gravatar.js";
import { accountPasswordsOk } from "../security/password-policy.js";
import { sameOrigin } from "../security/same-origin.js";

const TOKEN_RE = /^[a-f0-9]{32}$/;
const MAX_FIELD = 200;

/** The address Google sends the browser back to (registered in the Google client). */
export function callbackBase(req) {
  // The Dropbox public address saved on the admin page counts too, not only the env one.
  const dropboxBase = (integrations.get("dropbox").redirectBase || "").replace(/\/+$/, "");
  return googleRedirectBase || dropboxBase || publicBaseUrl || resolveOrigin(req, null);
}

export const callbackUri = (req) => `${callbackBase(req)}${CALLBACK_PATH}`;

/** Whether anyone can sign in at all; an open server (no accounts, no Google) has no login. */
const loginExists = () => users.hasUsers() || googleConfig.googleConfigured();

function pageHeaders(res) {
  res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY" });
}

/** A write from this site's own page: its origin (when sent) and its CSRF token. */
function sameSite(req, res) {
  if (!sameOrigin(req)) {
    res.status(403).json({ error: "origin mismatch" });
    return false;
  }
  if (!csrfOk(req)) {
    res.status(403).json({ error: "csrf token missing or wrong" });
    return false;
  }
  return true;
}

function renderLogin(req, res, { status = 200, next, error = null, notice = null }) {
  const google = sessionAccount(req);
  res.status(status).type("html").send(loginPage({
    lang: requestLang(req),
    next,
    csrf: csrfToken(req, res),
    google: googleConfig.googleConfigured(),
    googleState: google && google.status !== "approved" ? google.status : null,
    googleEmail: google?.email ?? null,
    passwords: accountPasswordsOk(req),
    error,
    notice,
    origin: resolveOrigin(req, publicBaseUrl),
    passkey: passkeys.usableHere(req, "web"),
  }));
}

function mountPasswordLogin(router) {
  const form = express.urlencoded({ extended: false, limit: "4kb" });

  router.get("/login", (req, res) => {
    pageHeaders(res);
    const next = safeNext(req.query.next);
    if (webUser(req) || !loginExists()) return res.redirect(302, next);
    renderLogin(req, res, { next, error: req.query.error !== undefined ? "google" : null });
  });

  router.post("/login", form, async (req, res) => {
    pageHeaders(res);
    const next = safeNext(req.body?.next);
    const ip = clientIp(req);
    const trusted = trustedHere(req);
    if (!trusted && store.isLocked(ip)) return renderLogin(req, retryAfter(res, lockoutRetryAfter(ip)), { status: 429, next, error: "locked", notice: lockNotice(requestLang(req), ip) });
    if (!csrfOk(req)) return renderLogin(req, res, { status: 403, next, error: "expired" });
    if (!accountPasswordsOk(req)) return renderLogin(req, res, { status: 403, next, error: "passwordsOff" });
    const name = String(req.body?.username ?? "").trim().slice(0, MAX_FIELD);
    const password = String(req.body?.password ?? "").slice(0, MAX_FIELD);
    const ok = Boolean(name && password) && (await users.verifyAsync(name, password));
    if (!ok) {
      if (!trusted) recordFailure(ip, req);
      return renderLogin(req, res, store.isLocked(ip) && !trusted ? { status: 401, next, error: "locked", notice: lockNotice(requestLang(req), ip) } : { status: 401, next, error: "wrong" });
    }
    store.clearFailure(ip);
    store.recordAccess(name, ip);
    store.recordLogin(name, "password", ip);
    issuePasswordSession(req, res, name);
    res.redirect(303, next);
  });

  router.get("/auth/me", (req, res) => {
    res.set("Cache-Control", "no-store");
    const who = webUser(req);
    if (!who) return res.status(401).json({ error: "not signed in" });
    const admin = who.kind === "password" ? users.isAdmin(who.name) : accounts.isAdmin(who.sub);
    const avatar = who.kind === "google" ? gravatarUrl(who.email) : null;
    res.json({ user: who.kind === "password" ? who.name : who.email, kind: who.kind, admin, avatar, csrf: csrfToken(req, res) });
  });

  router.post("/auth/logout", express.json({ limit: "1kb" }), (req, res) => {
    res.set("Cache-Control", "no-store");
    if (!sameSite(req, res)) return;
    clearUserSession(req, res);
    res.json({ ok: true });
  });
}

function mountGoogle(router) {
  router.get("/auth/google/start", (req, res) => {
    pageHeaders(res);
    const client = googleConfig.activeClient();
    const next = safeNext(req.query.next);
    if (!client) return res.redirect(302, `/login?next=${encodeURIComponent(next)}`);
    // The attempt cookie has to live on the host Google comes back to.
    const base = callbackBase(req);
    if (base && base !== resolveOrigin(req, null)) return res.redirect(302, `${base}/auth/google/start?next=${encodeURIComponent(next)}`);
    const attempt = newAttempt(next);
    res.append("Set-Cookie", cookieLine(req, OAUTH_COOKIE, seal(attempt, OAUTH_MS), { maxAgeMs: OAUTH_MS, path: "/auth/google" }));
    res.redirect(302, authUrl({ clientId: client.clientId, redirectUri: callbackUri(req), attempt }));
  });

  router.get(CALLBACK_PATH, async (req, res) => {
    pageHeaders(res);
    res.append("Set-Cookie", cookieLine(req, OAUTH_COOKIE, "", { maxAgeMs: 0, path: "/auth/google" }));
    const attempt = unseal(cookies(req)[OAUTH_COOKIE]);
    const next = safeNext(attempt?.next);
    const fail = (why) => {
      debug.log("google sign-in refused: %s", why);
      res.redirect(302, `/login?error=1&next=${encodeURIComponent(next)}`);
    };
    const client = googleConfig.activeClient();
    if (!client) return res.redirect(302, "/login");
    if (!attempt || typeof req.query.state !== "string" || req.query.state !== attempt.state) return fail("state mismatch");
    if (typeof req.query.code !== "string" || !req.query.code) return fail(req.query.error ? `google said ${String(req.query.error).slice(0, 40)}` : "no code");
    let who;
    try {
      const claims = await exchangeCode({ code: req.query.code, verifier: attempt.verifier, ...client, redirectUri: callbackUri(req) });
      who = checkClaims(claims, { clientId: client.clientId, nonce: attempt.nonce });
    } catch (err) {
      return fail(err.message);
    }
    if (who.error) return fail(who.error);
    const account = accounts.signIn(who);
    if (!account) return fail("account limit reached");
    if (account.status === "approved") store.recordLogin(`google:${account.sub}`, "google", clientIp(req));
    if (account.status === "pending" && account.createdAt === account.lastAt) debug.log("google sign-in: a new account is waiting for approval");
    issueUserSession(req, res, account.sub);
    // A pending account lands back on /login, which says it is waiting.
    res.redirect(302, account.status === "approved" ? next : `/login?next=${encodeURIComponent(next)}`);
  });
}

function mountDevice(router) {
  const toLogin = (req, res) => res.redirect(302, `/login?next=${encodeURIComponent(req.originalUrl)}`);

  router.get("/device", (req, res) => {
    if (!devicePairing) return res.status(404).type("text/plain").send("not found");
    pageHeaders(res);
    const who = webUser(req);
    if (!who) return toLogin(req, res);
    res.type("html").send(devicePage({
      lang: requestLang(req), view: req.query.done !== undefined ? "done" : "code", user: who.name ?? who.email, csrf: csrfToken(req, res),
    }));
  });

  router.get(["/pair/:token", "/admin/pair/:token"], (req, res, next) => {
    // An open server (nobody to sign in as) keeps the admin's own QR page.
    if (!devicePairing || !loginExists() || req.query.admin !== undefined || !TOKEN_RE.test(req.params.token)) return next();
    pageHeaders(res);
    const lang = requestLang(req);
    const link = readPairLink(req.params.token);
    if (!link) return res.status(410).type("html").send(devicePage({ lang, view: "expired" }));
    const who = webUser(req);
    if (!who) return toLogin(req, res);
    const { view, repair } = pairLinkView(link, who.approver);
    res.type("html").send(devicePage({
      lang, view, code: link.code, token: req.params.token, user: who.name ?? who.email, csrf: csrfToken(req, res), repair,
    }));
  });

  router.post("/auth/device/approve", express.json({ limit: "4kb" }), (req, res) => {
    res.set("Cache-Control", "no-store");
    if (!devicePairing) return res.status(404).json({ error: "pairing is off" });
    const who = webUser(req);
    if (!who) return res.status(401).json({ error: "sign in first" });
    if (!sameSite(req, res)) return;
    let token = req.body?.token;
    if (token === undefined && req.body?.code !== undefined) {
      const link = findPairLinkByCode(req.body.code);
      if (!link) return res.status(404).json({ error: "no device is waiting with that code" });
      token = link.token;
    }
    if (typeof token !== "string" || !TOKEN_RE.test(token)) return res.status(400).json({ error: "token or code required" });
    const result = approvePairLink(token, { label: req.body?.label, addedBy: who.approver });
    if (result === "expired") return res.status(410).json({ error: "pair link expired" });
    if (result === "used") return res.status(409).json({ error: "pair link already approved" });
    if (result === "limit") return deviceLimitRefusal(req, res);
    debug.log("pair: a signed-in %s account approved a device", who.kind);
    res.json({ ok: true });
  });
}

/** A refused passkey ceremony: its code, the spent challenge dropped. */
function passkeyRefusal(req, res, err) {
  if (!(err instanceof passkeys.PasskeyError)) throw err;
  res.append("Set-Cookie", passkeys.clearChallenge(req));
  res.status(err.code === "unknown" ? 401 : 400).json({ error: err.code });
}

/** The account a web passkey's owner key names, signed in; false when it can no longer sign in. */
function signInOwner(req, res, key) {
  const [kind, id] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
  if (kind === "password" && users.sessionStamp(id)) {
    issuePasskeySession(req, res, id);
    return id;
  }
  if (kind === "google" && accounts.isApproved(id)) {
    issueUserSession(req, res, id);
    return `google:${id}`;
  }
  return false;
}

function mountPasskeys(router) {
  const json = express.json({ limit: "16kb" });
  const ownerOf = (who) => ({ kind: who.kind, name: who.name, sub: who.sub });

  router.post("/auth/passkey/options", json, async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (!sameSite(req, res)) return;
    const ip = clientIp(req);
    if (!trustedHere(req) && store.isLocked(ip)) return retryAfter(res, lockoutRetryAfter(ip)).status(429).json({ error: "locked" });
    try {
      const { options, cookie } = await passkeys.startSignIn(req, "web");
      res.append("Set-Cookie", cookie).json(options);
    } catch (err) {
      passkeyRefusal(req, res, err);
    }
  });

  router.post("/auth/passkey/login", json, async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (!sameSite(req, res)) return;
    const ip = clientIp(req);
    const trusted = trustedHere(req);
    if (!trusted && store.isLocked(ip)) return retryAfter(res, lockoutRetryAfter(ip)).status(429).json({ error: "locked" });
    try {
      const key = await passkeys.finishSignIn(req, "web", req.body?.response);
      const who = signInOwner(req, res, key);
      if (!who) throw new passkeys.PasskeyError("unknown");
      res.append("Set-Cookie", passkeys.clearChallenge(req));
      store.clearFailure(ip);
      store.recordAccess(who, ip);
      store.recordLogin(who, "passkey", ip);
      res.json({ ok: true, next: safeNext(req.body?.next) });
    } catch (err) {
      if (err instanceof passkeys.PasskeyError && !trusted) recordFailure(ip, req);
      passkeyRefusal(req, res, err);
    }
  });

  router.get("/auth/passkeys", (req, res) => {
    res.set("Cache-Control", "no-store");
    const who = webUser(req);
    if (!who) return res.status(401).json({ error: "not signed in" });
    res.json({ passkeys: passkeys.list("web", ownerOf(who)), available: Boolean(passkeys.relyingParty(req)), max: passkeys.MAX_PER_OWNER });
  });

  router.post("/auth/passkeys/options", json, async (req, res) => {
    res.set("Cache-Control", "no-store");
    const who = webUser(req);
    if (!who) return res.status(401).json({ error: "not signed in" });
    if (!sameSite(req, res)) return;
    try {
      const { options, cookie } = await passkeys.startAdd(req, "web", ownerOf(who), who.name ?? who.email);
      res.append("Set-Cookie", cookie).json(options);
    } catch (err) {
      passkeyRefusal(req, res, err);
    }
  });

  router.post("/auth/passkeys/add", json, async (req, res) => {
    res.set("Cache-Control", "no-store");
    const who = webUser(req);
    if (!who) return res.status(401).json({ error: "not signed in" });
    if (!sameSite(req, res)) return;
    try {
      const added = await passkeys.finishAdd(req, "web", ownerOf(who), req.body?.response);
      res.append("Set-Cookie", passkeys.clearChallenge(req)).json({ ok: true, id: added.id });
    } catch (err) {
      passkeyRefusal(req, res, err);
    }
  });

  router.post("/auth/passkeys/remove", json, (req, res) => {
    res.set("Cache-Control", "no-store");
    const who = webUser(req);
    if (!who) return res.status(401).json({ error: "not signed in" });
    if (!sameSite(req, res)) return;
    const id = typeof req.body?.id === "string" ? req.body.id : "";
    if (!passkeys.remove("web", ownerOf(who), id)) return res.status(404).json({ error: "unknown" });
    res.json({ ok: true });
  });
}

export default function webLoginRouter() {
  const router = express.Router();
  mountPasswordLogin(router);
  mountGoogle(router);
  mountDevice(router);
  mountPasskeys(router);
  return router;
}
