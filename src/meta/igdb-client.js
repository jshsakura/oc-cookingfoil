/**
 * IGDB's API, shared by the Switch rating collector and the retro metadata:
 * a Twitch app token (client credentials, kept until shortly before it
 * expires) and POST queries in IGDB's own query language. Keys come from the
 * admin page's integrations (or COOK_IGDB_CLIENT_ID/SECRET).
 */
import * as integrations from "../security/integrations.js";

const TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const API = "https://api.igdb.com/v4";
const TIMEOUT_MS = 15_000;

let token = null; // { value, expiresAt }

async function getJson(fetchImpl, url, init = {}) {
  const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  return res.json();
}

export const configured = () => integrations.configured("igdb");

async function auth(fetchImpl) {
  if (token && Date.now() < token.expiresAt - 30_000) return token.value;
  const { clientId, clientSecret } = integrations.get("igdb");
  const url = `${TOKEN_URL}?client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}&grant_type=client_credentials`;
  const body = await getJson(fetchImpl, url, { method: "POST" });
  token = { value: body.access_token, expiresAt: Date.now() + Number(body.expires_in || 0) * 1000 };
  return token.value;
}

/** One query against an endpoint ("games", …); the parsed JSON array. */
export async function query(endpoint, body, { fetchImpl = fetch } = {}) {
  const bearer = await auth(fetchImpl);
  return getJson(fetchImpl, `${API}/${endpoint}`, {
    method: "POST", body,
    headers: { "Client-ID": integrations.get("igdb").clientId, Authorization: `Bearer ${bearer}`, Accept: "application/json" },
  });
}

/** For tests. */
export function resetToken() {
  token = null;
}
