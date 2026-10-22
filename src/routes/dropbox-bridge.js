/**
 * Dropbox sign-in bridge for the client app's save sync, speaking the same
 * protocol as oc-save-keeper's bridge so its client code works unchanged:
 *
 *   POST /api/dropbox/v1/sessions/start              → { session_id, poll_token, authorize_url, expires_in, poll_url }
 *   POST /api/dropbox/v1/sessions/:id/status         { poll_token } → { status, retry_after }
 *   POST /api/dropbox/v1/sessions/:id/consume        { poll_token } → { authorization_code, code_verifier, state, redirect_uri, token_endpoint }
 *   GET  /api/dropbox/oauth/dropbox/callback         where Dropbox sends the phone back
 *
 * The console shows authorize_url as a QR code, the phone signs in to Dropbox,
 * and the console then trades the code for tokens itself (PKCE, no client
 * secret). The tokens never pass through this server and no save data ever
 * does. Sessions live in memory for 15 minutes.
 *
 * The session endpoints sit behind the shop's own sign-in (accounts or a
 * paired device), so only people allowed into the shop can use the operator's
 * Dropbox app. The callback is public: it is opened by the phone's browser.
 * At most MAX_SESSIONS_PER_ACCOUNT sign-ins per account are in progress at
 * once, and MAX_SESSIONS in all.
 */
import crypto from "crypto";
import express from "express";
import { publicBaseUrl } from "../helpers/envs.js";
import * as integrations from "../security/integrations.js";
import { resolveOrigin } from "../helpers/origin.js";
import { requestLang, tableLang } from "../meta/langs.js";
import { tooManyRequests } from "../security/retry-after.js";
import { ownerKey } from "../security/link-identity.js";

const AUTHORIZE_URL = "https://www.dropbox.com/oauth2/authorize";
const TOKEN_URL = "https://api.dropboxapi.com/oauth2/token";
const SESSION_TTL_MS = 15 * 60 * 1000;
const CONSUMED_TTL_MS = 60 * 1000;
export const MAX_SESSIONS = 500;
// One account's share, so a single sign-in can't hold every place.
export const MAX_SESSIONS_PER_ACCOUNT = 5;
export const BRIDGE_PATH = "/api/dropbox";

const sessions = new Map(); // session_id → { status, state, pollHash, verifier, code, error, redirectUri, expiresAt }
const byState = new Map();  // state → session_id

const token = (bytes) => crypto.randomBytes(bytes).toString("base64url");
const sha256 = (s) => crypto.createHash("sha256").update(s).digest();
const challengeOf = (verifier) => sha256(verifier).toString("base64url");

/** Seconds until the oldest sign-in in progress (of `owner`, when given) expires and frees its place. */
function firstExpiryIn(now = Date.now(), owner = null) {
  let first = Infinity;
  for (const s of sessions.values()) if (!owner || s.owner === owner) first = Math.min(first, s.expiresAt);
  return Number.isFinite(first) ? (first - now) / 1000 : 60;
}

const sessionsOf = (owner) => [...sessions.values()].filter((s) => s.owner === owner).length;

function sweep(now = Date.now()) {
  for (const [id, s] of sessions) {
    if (s.expiresAt <= now) {
      sessions.delete(id);
      byState.delete(s.state);
    }
  }
}

function live(id, now = Date.now()) {
  const s = sessions.get(String(id));
  return s && s.expiresAt > now ? s : null;
}

function pollTokenOk(session, given) {
  if (typeof given !== "string" || given.length < 32 || given.length > 256) return false;
  return crypto.timingSafeEqual(session.pollHash, sha256(given));
}

/** The address Dropbox sends the phone back to; must be registered in the Dropbox app. */
export function redirectUriFor(req) {
  const origin = integrations.get("dropbox").redirectBase.replace(/\/+$/, "") || publicBaseUrl || resolveOrigin(req, null);
  return `${origin}${BRIDGE_PATH}/oauth/dropbox/callback`;
}

/** The session endpoints (behind the shop's sign-in). 404 until COOK_DROPBOX_APP_KEY is set. */
export function dropboxSessionsRouter() {
  const router = express.Router();
  router.use(express.json({ limit: "4kb" }));
  router.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (!integrations.get("dropbox").appKey) return res.status(404).json({ detail: "dropbox sync is not configured on this server" });
    next();
  });

  router.post("/v1/sessions/start", (req, res) => {
    sweep();
    const owner = ownerKey(req);
    if (sessionsOf(owner) >= MAX_SESSIONS_PER_ACCOUNT) return tooManyRequests(res, firstExpiryIn(Date.now(), owner)).json({ detail: "too many sign-ins in progress for this account" });
    if (sessions.size >= MAX_SESSIONS) return tooManyRequests(res, firstExpiryIn()).json({ detail: "too many sign-ins in progress" });
    const id = token(18), state = token(18), poll = token(24), verifier = token(64);
    const redirectUri = redirectUriFor(req);
    sessions.set(id, {
      status: "pending", owner, state, pollHash: sha256(poll), verifier, code: "", error: "",
      redirectUri, expiresAt: Date.now() + SESSION_TTL_MS,
    });
    byState.set(state, id);
    const authorize = new URL(AUTHORIZE_URL);
    authorize.search = new URLSearchParams({
      client_id: integrations.get("dropbox").appKey, redirect_uri: redirectUri, response_type: "code",
      token_access_type: "offline", state, code_challenge_method: "S256", code_challenge: challengeOf(verifier),
    }).toString();
    const base = redirectUri.slice(0, -"/oauth/dropbox/callback".length);
    res.json({
      session_id: id, poll_token: poll, authorize_url: authorize.toString(),
      expires_in: SESSION_TTL_MS / 1000, poll_url: `${base}/v1/sessions/${id}/status`,
    });
  });

  router.post("/v1/sessions/:id/status", (req, res) => {
    const s = live(req.params.id);
    if (!s) return res.json({ status: "expired", retry_after: 2 });
    if (!pollTokenOk(s, req.body?.poll_token)) return res.status(401).json({ detail: "invalid poll token" });
    res.json({ status: s.status, retry_after: 2 });
  });

  router.post("/v1/sessions/:id/consume", (req, res) => {
    const s = live(req.params.id);
    if (!s) return res.status(404).json({ detail: "session expired" });
    if (!pollTokenOk(s, req.body?.poll_token)) return res.status(401).json({ detail: "invalid poll token" });
    if (s.status === "pending") return res.status(409).json({ detail: "authorization pending" });
    if (s.status === "failed") return res.status(409).json({ detail: s.error || "authorization failed" });
    if (s.status === "consumed") return res.status(409).json({ detail: "already consumed" });
    const out = {
      authorization_code: s.code, code_verifier: s.verifier, state: s.state,
      redirect_uri: s.redirectUri, token_endpoint: TOKEN_URL,
    };
    // One use: the code and verifier are gone the moment they are handed over.
    Object.assign(s, { status: "consumed", code: "", verifier: "", expiresAt: Date.now() + CONSUMED_TTL_MS });
    byState.delete(s.state);
    res.json(out);
  });
  return router;
}

export const DROPBOX_PAGE_TEXT = {
  ko: { ok: "Dropbox 를 연결했습니다", okBody: "기기로 돌아가면 곧 연결이 끝납니다. 이 창은 닫아도 됩니다.", fail: "Dropbox 연결에 실패했습니다", failBody: "기기에서 다시 시도합니다.", gone: "연결 요청이 만료됐습니다", goneBody: "기기에서 새 QR 을 띄워 다시 시도합니다." },
  en: { ok: "Dropbox connected", okBody: "Go back to your console; it finishes in a moment. You can close this window.", fail: "Dropbox was not connected", failBody: "Try again from your console.", gone: "This sign-in has expired", goneBody: "Show a new QR code on your console and try again." },
  ja: { ok: "Dropbox を接続しました", okBody: "本体に戻るとまもなく完了します。このウィンドウは閉じてかまいません。", fail: "Dropbox を接続できませんでした", failBody: "本体からもう一度試してください。", gone: "このサインインは期限切れです", goneBody: "本体で新しい QR コードを表示して、もう一度試してください。" },
  zh: { ok: "已连接 Dropbox", okBody: "回到主机即可完成。可以关闭这个窗口。", fail: "未能连接 Dropbox", failBody: "请在主机上再试一次。", gone: "此登录已过期", goneBody: "请在主机上显示新的二维码再试一次。" },
  "zh-Hant": { ok: "已連接 Dropbox", okBody: "回到主機即可完成。可以關閉這個視窗。", fail: "未能連接 Dropbox", failBody: "請在主機上再試一次。", gone: "此登入已過期", goneBody: "請在主機上顯示新的 QR 碼再試一次。" },
  es: { ok: "Dropbox conectado", okBody: "Vuelve a tu consola; terminará en un momento. Puedes cerrar esta ventana.", fail: "No se pudo conectar Dropbox", failBody: "Vuelve a intentarlo desde tu consola.", gone: "Este inicio de sesión ha caducado", goneBody: "Muestra un nuevo código QR en tu consola e inténtalo de nuevo." },
  fr: { ok: "Dropbox connecté", okBody: "Revenez à votre console, la connexion se termine dans un instant. Vous pouvez fermer cette fenêtre.", fail: "Dropbox n'a pas pu être connecté", failBody: "Réessayez depuis votre console.", gone: "Cette connexion a expiré", goneBody: "Affichez un nouveau code QR sur votre console et réessayez." },
  de: { ok: "Dropbox verbunden", okBody: "Kehre zu deiner Konsole zurück, gleich ist alles fertig. Du kannst dieses Fenster schließen.", fail: "Dropbox wurde nicht verbunden", failBody: "Versuche es erneut über deine Konsole.", gone: "Diese Anmeldung ist abgelaufen", goneBody: "Zeige einen neuen QR-Code auf deiner Konsole an und versuche es erneut." },
  it: { ok: "Dropbox collegato", okBody: "Torna alla console, la procedura si conclude tra un momento. Puoi chiudere questa finestra.", fail: "Impossibile collegare Dropbox", failBody: "Riprova dalla console.", gone: "Questo accesso è scaduto", goneBody: "Mostra un nuovo codice QR sulla console e riprova." },
  pt: { ok: "Dropbox conectado", okBody: "Volte ao console, a conexão termina em instantes. Você pode fechar esta janela.", fail: "Não foi possível conectar o Dropbox", failBody: "Tente novamente pelo console.", gone: "Este login expirou", goneBody: "Mostre um novo código QR no console e tente novamente." },
  ru: { ok: "Dropbox подключён", okBody: "Вернитесь к консоли, подключение скоро завершится. Это окно можно закрыть.", fail: "Не удалось подключить Dropbox", failBody: "Повторите попытку с консоли.", gone: "Срок действия входа истёк", goneBody: "Покажите новый QR-код на консоли и повторите попытку." },
  nl: { ok: "Dropbox gekoppeld", okBody: "Ga terug naar je console, het is zo klaar. Je kunt dit venster sluiten.", fail: "Dropbox is niet gekoppeld", failBody: "Probeer het opnieuw vanaf je console.", gone: "Deze aanmelding is verlopen", goneBody: "Toon een nieuwe QR-code op je console en probeer het opnieuw." },
};
function page(res, status, lang, kind, detail = "") {
  const shown = tableLang(DROPBOX_PAGE_TEXT, lang);
  const t = DROPBOX_PAGE_TEXT[shown];
  const title = t[kind], body = t[`${kind}Body`];
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  res.status(status).set({ "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'" })
    .type("html").send(`<!doctype html><html lang="${shown}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{margin:0;box-sizing:border-box;min-height:100vh;min-height:100dvh;display:grid;place-items:center;padding:24px;background:#f2f1ee;color:#16161a;font:16px/1.6 system-ui,sans-serif}
@media(prefers-color-scheme:dark){body{background:#16161a;color:#f2f1ee}.card{background:#1f1f24!important}}
.card{background:#fff;border-radius:20px;padding:32px;max-width:420px;text-align:center}h1{font-size:22px;margin:12px 0 8px}p{margin:0;opacity:.75}</style></head>
<body><main class="card"><img src="/assets/cookingfoil.svg" alt="" width="56" height="56"><h1>${esc(title)}</h1><p>${esc(body)}</p>${detail ? `<p>${esc(detail)}</p>` : ""}</main></body></html>`);
}

/** The callback the phone lands on after Dropbox. Public, matched by its one-time state. */
export function dropboxCallback(req, res) {
  const lang = requestLang(req);
  const state = typeof req.query.state === "string" ? req.query.state : "";
  const id = byState.get(state);
  const s = id && live(id);
  if (!s || s.state !== state || s.status !== "pending") return page(res, 410, lang, "gone");
  byState.delete(state);
  const code = typeof req.query.code === "string" ? req.query.code : "";
  if (code) {
    Object.assign(s, { status: "approved", code });
    return page(res, 200, lang, "ok");
  }
  const reason = typeof req.query.error_description === "string" ? req.query.error_description.slice(0, 200) : "";
  Object.assign(s, { status: "failed", error: reason || "authorization denied" });
  return page(res, 200, lang, "fail", reason);
}

/** For tests. */
export function resetForTests() {
  sessions.clear();
  byState.clear();
}
