/**
 * Google sign-in (OpenID Connect, authorization code flow with PKCE).
 *
 * The browser goes to Google with a random state, nonce and PKCE challenge;
 * Google sends it back to /auth/google/callback with a code, which the server
 * trades for an ID token straight from Google's token endpoint over TLS. A
 * token received that way needs no signature check (OIDC Core 3.1.3.7), only
 * its issuer, audience, expiry, nonce and a verified email.
 */
import crypto from "crypto";

export const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const CALLBACK_PATH = "/auth/google/callback";
const ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);
const CLOCK_SKEW_S = 60;
const TOKEN_TIMEOUT_MS = 10_000;

const random = () => crypto.randomBytes(32).toString("base64url");

/** A new sign-in attempt: what goes into the cf_oauth cookie. */
export function newAttempt(next) {
  return { state: random(), nonce: random(), verifier: random(), next };
}

/** Where to send the browser for one attempt. Pure. */
export function authUrl({ clientId, redirectUri, attempt }) {
  const challenge = crypto.createHash("sha256").update(attempt.verifier).digest("base64url");
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email",
    state: attempt.state,
    nonce: attempt.nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  return `${AUTH_URL}?${q}`;
}

/** The claims of an ID token, unverified (it came straight from Google). Pure. */
export function decodeIdToken(idToken) {
  const parts = String(idToken ?? "").split(".");
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

/**
 * The account an ID token names, or an error code. Pure.
 * @returns {{ sub: string, email: string } | { error: string }}
 */
export function checkClaims(claims, { clientId, nonce, now = Date.now() }) {
  if (!claims) return { error: "bad-token" };
  if (!ISSUERS.has(claims.iss)) return { error: "bad-issuer" };
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(clientId)) return { error: "bad-audience" };
  if (!Number.isFinite(claims.exp) || claims.exp + CLOCK_SKEW_S < now / 1000) return { error: "expired" };
  if (!nonce || claims.nonce !== nonce) return { error: "bad-nonce" };
  if (typeof claims.sub !== "string" || !claims.sub) return { error: "bad-token" };
  if (claims.email_verified !== true || typeof claims.email !== "string") return { error: "unverified-email" };
  return { sub: claims.sub, email: claims.email.toLowerCase() };
}

/** Trade the code for Google's ID token claims. Throws on a refused exchange. */
export async function exchangeCode({ code, verifier, clientId, clientSecret, redirectUri, fetchImpl = fetch }) {
  const res = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      code, code_verifier: verifier, client_id: clientId, client_secret: clientSecret,
      redirect_uri: redirectUri, grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.id_token) throw new Error(`token exchange refused (${res.status} ${body.error ?? ""})`.trim());
  return decodeIdToken(body.id_token);
}

/**
 * Where to go after signing in: a path on this server, never another site or
 * the sign-in pages themselves (an open redirect or a loop). Pure.
 */
export function safeNext(raw) {
  const next = String(raw ?? "");
  if (!/^\/(?![/\\])[^\s\\]*$/.test(next) || next.length > 512) return "/";
  if (/^\/(login|auth)(\/|\?|$)/.test(next)) return "/";
  return next;
}
