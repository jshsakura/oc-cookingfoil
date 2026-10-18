/**
 * Which passwords this server takes right now (the setting changes live from the admin page):
 *
 *   passwordLogin  off: accounts' own passwords are taken nowhere (the web form, pairing), and
 *                  what they were traded for (session, download and enrollment tokens, automation
 *                  tokens) stops working
 *
 * A console never signs in with a password for its ongoing access; an ID and password count at
 * most once, on the pairing routes, to approve it (auth-guard.js pairSignIn).
 *
 * Nobody gets locked out: while Google sign-in is not set up or has no approved admin, passwords work
 * again on their own, and COOK_PASSWORD_LOGIN_FORCE=true in compose turns them on whatever is saved
 * (for a Google outage). This machine itself, asked directly (no proxy in between), is never turned away.
 */
import { passwordLogin, passwordLoginForced } from "../helpers/envs.js";
import { trustedHere } from "./net.js";
import * as googleConfig from "./google-config.js";
import * as googleAccounts from "./google-accounts.js";
import { DENY } from "./deny-reasons.js";

/** Google sign-in set up, with at least one approved Google admin. */
export const googleReady = () => googleConfig.googleConfigured() && googleAccounts.list().some((a) => a.status === "approved" && a.role === "admin");

/** Whether accounts' own passwords count at all right now (the setting, unless that would lock everyone out). */
export const passwordsOn = () => passwordLogin || passwordLoginForced || !googleReady();

/** Whether an account's own password may be used for this request (the web form, a password session). */
export const accountPasswordsOk = (req) => passwordsOn() || trustedHere(req);

/** Why an ID and password at pairing are refused here, or null when they may be checked. */
export const basicRefusal = (req) => (passwordsOn() || trustedHere(req) ? null : DENY.PASSWORD_LOGIN_OFF);

/** Whether something an ID-and-password account owns (a token, an enrollment) may still be used. */
export const passwordOwnerOk = () => passwordsOn();
