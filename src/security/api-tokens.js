/**
 * Automation tokens for the admin API, so a script or an AI assistant can do
 * what the admin page does without a browser session (and read /admin/guide.md):
 *
 *   Authorization: Bearer cft_<id>_<secret>
 *
 * A token acts as the admin account that made it, only on /admin/api/*, and
 * stops working when that account stops being an admin. It cannot make or
 * revoke tokens, nor change the admin page's two-step login. Only a SHA-256 of
 * the secret is kept, in ${COOK_DATA_DIR}/security/api-tokens.json (0600); the
 * token itself is shown once, when it is made.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { dataDir } from "../helpers/envs.js";

const FILE = path.join(dataDir, "security", "api-tokens.json");
const TOKEN_RE = /^Bearer\s+cft_([a-f0-9]{8})_([A-Za-z0-9_-]{32,64})$/i;
const LABEL_MAX = 64;
const MAX_TOKENS = 20;
const TOUCH_MS = 60_000;

let tokens = null;

const sha = (s) => crypto.createHash("sha256").update(s).digest();

function load() {
  if (tokens) return tokens;
  try {
    tokens = JSON.parse(fs.readFileSync(FILE, "utf8")).tokens ?? [];
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
    tokens = [];
  }
  return tokens;
}

function persist(next) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true, mode: 0o700 });
  fs.writeFileSync(`${FILE}.tmp`, JSON.stringify({ version: 1, tokens: next }, null, 2), { mode: 0o600 });
  fs.renameSync(`${FILE}.tmp`, FILE);
  tokens = next;
}

export class TokenError extends Error {}

/** Whether a request carries a token at all (right or wrong). */
export const presented = (req) => /^Bearer\s+cft_/i.test(req.headers.authorization ?? "");

/** The token record an Authorization header names, or null. Constant-time on the secret. */
export function verify(header, now = Date.now()) {
  const m = TOKEN_RE.exec(String(header ?? ""));
  if (!m) return null;
  const rec = load().find((t) => t.id === m[1].toLowerCase());
  if (!rec) return null;
  const want = Buffer.from(rec.hash, "hex");
  const got = sha(m[2]);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
  if (now - (rec.lastUsedAt ?? 0) > TOUCH_MS) persist(load().map((t) => (t.id === rec.id ? { ...t, lastUsedAt: now } : t)));
  return rec;
}

/** Makes a token for an admin account. Returns { token, id }; the token is not kept. */
export function create(owner, label) {
  if (load().length >= MAX_TOKENS) throw new TokenError(`토큰은 ${MAX_TOKENS}개까지 만들 수 있습니다`);
  const id = crypto.randomBytes(4).toString("hex");
  const secret = crypto.randomBytes(32).toString("base64url");
  const rec = { id, owner: String(owner), label: String(label ?? "").trim().slice(0, LABEL_MAX), hash: sha(secret).toString("hex"), createdAt: Date.now(), lastUsedAt: null };
  persist([...load(), rec]);
  return { id, token: `cft_${id}_${secret}` };
}

/** Tokens without their hashes. */
export function list() {
  return load().map(({ hash: _hash, ...t }) => t);
}

export function revoke(id) {
  const next = load().filter((t) => t.id !== id);
  if (next.length === load().length) throw new TokenError("없는 토큰입니다");
  persist(next);
}

/** Test-only. */
export function resetForTests() {
  tokens = null;
}
