/**
 * Which passwords this server takes right now (both settings change live from the admin page):
 *
 *   passwordLogin            off: accounts' own passwords are taken nowhere (the web form, Basic from
 *                            consoles, pairing, the realtime socket), and what they were traded for
 *                            (session, download and enrollment tokens, automation tokens) stops working;
 *                            per-device logins (cf-…) still work
 *   consolePasswordsLanOnly  on: a password from a console counts only from the home network, not through
 *                            the tunnel or a public address
 *
 * Nobody gets locked out: while Google sign-in is not set up or has no approved admin, passwords work
 * again on their own, and COOK_PASSWORD_LOGIN_FORCE=true in compose turns them on whatever is saved
 * (for a Google outage). This machine itself, asked directly (no proxy in between), is never turned away.
 */
import { passwordLogin, consolePasswordsLanOnly, passwordLoginForced } from "../helpers/envs.js";
import { isLoopbackSocket, isPrivateCaller } from "./net.js";
import { trustLoopback } from "./limits.js";
import * as deviceLogins from "./device-logins.js";
import * as googleConfig from "./google-config.js";
import * as googleAccounts from "./google-accounts.js";
import { DENY } from "./deny-reasons.js";

const header = (req, name) => (typeof req.get === "function" ? req.get(name) : req.headers?.[name.toLowerCase()]);
const PROXY_HEADERS = ["cf-connecting-ip", "x-forwarded-for", "forwarded", "x-real-ip"];

/** Whether the request came from outside the home network: through the tunnel, or a public address. */
export const fromOutside = (req) => Boolean(header(req, "cf-connecting-ip")) || !isPrivateCaller(req);

/** This machine asking directly: a loopback socket that no proxy forwarded (a proxy on 127.0.0.1 would bring the internet). */
export const trustedHere = (req) => trustLoopback && isLoopbackSocket(req) && !PROXY_HEADERS.some((h) => header(req, h));

/** Google sign-in set up, with at least one approved Google admin. */
export const googleReady = () => googleConfig.googleConfigured() && googleAccounts.list().some((a) => a.status === "approved" && a.role === "admin");

/** Whether accounts' own passwords count at all right now (the setting, unless that would lock everyone out). */
export const passwordsOn = () => passwordLogin || passwordLoginForced || !googleReady();

/** Whether an account's own password may be used for this request (the web form, a password session). */
export const accountPasswordsOk = (req) => passwordsOn() || trustedHere(req);

/** The user name in a Basic header, or null. */
export function basicName(req) {
  const m = /^Basic\s+(\S+)$/i.exec(String(header(req, "authorization") ?? ""));
  if (!m) return null;
  const decoded = Buffer.from(m[1], "base64").toString("utf8");
  const sep = decoded.indexOf(":");
  return sep < 0 ? null : decoded.slice(0, sep);
}

/** Why a Basic sign-in with `name` is refused here, or null when it may be checked. */
export function basicRefusal(req, name = basicName(req)) {
  if (name == null || trustedHere(req)) return null;
  if (consolePasswordsLanOnly && fromOutside(req)) return DENY.CONSOLE_PASSWORDS_LAN_ONLY;
  if (!passwordsOn() && !deviceLogins.has(name)) return DENY.PASSWORD_LOGIN_OFF;
  return null;
}

/** Whether something an ID-and-password account owns (a token, an enrollment) may still be used. */
export const passwordOwnerOk = () => passwordsOn();
