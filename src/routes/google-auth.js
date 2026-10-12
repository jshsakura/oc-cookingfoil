/**
 * Google sign-in and the phone's device approval. Mounted outside the shop's
 * Basic sign-in, since the phone that scans a console's QR has no password.
 *
 *   GET  /login?next=               sign-in page (or where `next` points, once approved)
 *   GET  /auth/google/start?next=   off to Google
 *   GET  /auth/google/callback      back from Google: session cookie, then `next`
 *   POST /auth/logout
 *   GET  /device                    type a console's 8-character code
 *   GET  /pair/<token>              what a console's QR opens: one button to approve it
 *   GET  /admin/pair/<token>        the same
 *   POST /auth/device/approve       { token | code, label? } → { ok: true }
 *
 * Only accounts the admin approved can approve consoles. Until Google sign-in is
 * configured, both QR paths fall through to the pages behind the shop's sign-in,
 * and `?admin=1` reaches those at any time.
 */
import express from "express";

import * as accounts from "../security/google-accounts.js";
import {
  OAUTH_COOKIE, OAUTH_MS, approvedAccount, clearUserSession, cookieLine, cookies, issueUserSession, seal, sessionAccount, unseal,
} from "../security/user-session.js";
import { CALLBACK_PATH, authUrl, checkClaims, exchangeCode, newAttempt, safeNext } from "../security/google-oauth.js";
import { readPairLink, findPairLinkByCode } from "../security/pairing-link.js";
import { approvePairLink } from "../security/pairing-approve.js";
import * as store from "../security/store.js";
import { devicePairing, dropboxRedirectBase, googleClientId, googleClientSecret, googleRedirectBase, publicBaseUrl } from "../helpers/envs.js";
import { resolveOrigin } from "../helpers/origin.js";
import { requestLang } from "../meta/categories.js";
import { devicePage, loginPage } from "./login-page.js";
import debug from "../debug.js";

const TOKEN_RE = /^[a-f0-9]{32}$/;
export const googleConfigured = () => Boolean(googleClientId && googleClientSecret);

/** The address Google sends the browser back to (registered in the Google client). */
export function callbackBase(req) {
  return googleRedirectBase || dropboxRedirectBase || publicBaseUrl || resolveOrigin(req, null);
}

function pageHeaders(res) {
  res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY" });
}

/** Approvals name the account; the admin sees it on the device list. */
export const approverName = (account) => `google:${account.email}`;

function mountSignIn(router) {
  router.get("/login", (req, res) => {
    pageHeaders(res);
    const lang = requestLang(req);
    const next = safeNext(req.query.next);
    const token = /\/pair\/([a-f0-9]{32})$/.exec(next)?.[1];
    const adminHref = token ? `/admin/pair/${token}?admin=1` : null;
    if (!googleConfigured()) return res.type("html").send(loginPage({ lang, state: "off", adminHref }));
    const account = sessionAccount(req);
    if (account?.status === "approved" && next !== "/login") return res.redirect(302, next);
    const state = account ? account.status : "signin";
    res.type("html").send(loginPage({ lang, state, next, email: account?.email, error: req.query.error !== undefined, adminHref }));
  });

  router.get("/auth/google/start", (req, res) => {
    pageHeaders(res);
    if (!googleConfigured()) return res.redirect(302, "/login");
    const next = safeNext(req.query.next);
    // The attempt cookie has to live on the host Google comes back to.
    const base = callbackBase(req);
    if (base && base !== resolveOrigin(req, null)) return res.redirect(302, `${base}/auth/google/start?next=${encodeURIComponent(next)}`);
    const attempt = newAttempt(next);
    res.append("Set-Cookie", cookieLine(req, OAUTH_COOKIE, seal(attempt, OAUTH_MS), { maxAgeMs: OAUTH_MS, path: "/auth/google" }));
    res.redirect(302, authUrl({ clientId: googleClientId, redirectUri: `${base}${CALLBACK_PATH}`, attempt }));
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
    if (!googleConfigured()) return res.redirect(302, "/login");
    if (!attempt || typeof req.query.state !== "string" || req.query.state !== attempt.state) return fail("state mismatch");
    if (typeof req.query.code !== "string" || !req.query.code) return fail(req.query.error ? `google said ${String(req.query.error).slice(0, 40)}` : "no code");
    let who;
    try {
      const claims = await exchangeCode({
        code: req.query.code, verifier: attempt.verifier, clientId: googleClientId, clientSecret: googleClientSecret,
        redirectUri: `${callbackBase(req)}${CALLBACK_PATH}`,
      });
      who = checkClaims(claims, { clientId: googleClientId, nonce: attempt.nonce });
    } catch (err) {
      return fail(err.message);
    }
    if (who.error) return fail(who.error);
    const account = accounts.signIn(who);
    if (!account) return fail("account limit reached");
    if (account.status === "pending" && account.createdAt === account.lastAt) debug.log("google sign-in: a new account is waiting for approval");
    issueUserSession(req, res, account.sub);
    res.redirect(302, account.status === "approved" ? next : `/login?next=${encodeURIComponent(next)}`);
  });

  router.post("/auth/logout", (req, res) => {
    res.set("Cache-Control", "no-store");
    clearUserSession(req, res);
    res.json({ ok: true });
  });
}

function mountDevice(router) {
  router.get("/device", (req, res) => {
    pageHeaders(res);
    const account = approvedAccount(req);
    if (!account) return res.redirect(302, "/login?next=%2Fdevice");
    const lang = requestLang(req);
    res.type("html").send(devicePage({ lang, view: req.query.done !== undefined ? "done" : "code", email: account.email }));
  });

  router.get(["/pair/:token", "/admin/pair/:token"], (req, res, next) => {
    if (!devicePairing || !googleConfigured() || req.query.admin !== undefined || !TOKEN_RE.test(req.params.token)) return next();
    pageHeaders(res);
    const lang = requestLang(req);
    const link = readPairLink(req.params.token);
    if (!link) return res.status(410).type("html").send(devicePage({ lang, view: "expired" }));
    const account = approvedAccount(req);
    if (!account) return res.redirect(302, `/login?next=${encodeURIComponent(req.path)}`);
    const done = link.used || store.isDeviceApproved(link.deviceKey);
    res.type("html").send(devicePage({ lang, view: done ? "done" : "confirm", code: link.code, token: req.params.token, email: account.email }));
  });

  router.post("/auth/device/approve", express.json({ limit: "4kb" }), (req, res) => {
    res.set("Cache-Control", "no-store");
    if (!devicePairing) return res.status(404).json({ error: "pairing is off" });
    const account = approvedAccount(req);
    if (!account) return res.status(401).json({ error: "sign in first" });
    const origin = req.get("Origin");
    if (!origin || origin !== resolveOrigin(req, publicBaseUrl)) return res.status(403).json({ error: "origin mismatch" });
    let token = req.body?.token;
    if (token === undefined && req.body?.code !== undefined) {
      const link = findPairLinkByCode(req.body.code);
      if (!link) return res.status(404).json({ error: "no device is waiting with that code" });
      token = link.token;
    }
    if (typeof token !== "string" || !TOKEN_RE.test(token)) return res.status(400).json({ error: "token or code required" });
    const result = approvePairLink(token, { label: req.body?.label, addedBy: approverName(account) });
    if (result === "expired") return res.status(410).json({ error: "pair link expired" });
    if (result === "used") return res.status(409).json({ error: "pair link already approved" });
    debug.log("pair: a Google account approved a device");
    res.json({ ok: true });
  });
}

export default function googleAuthRouter() {
  const router = express.Router();
  mountSignIn(router);
  mountDevice(router);
  return router;
}
