/**
 * What the signed lane remembers about direct links across restarts, in
 * ${COOK_DATA_DIR}/security/download-links.json (0600):
 *
 *   ids:  { <u>: { acct, dev, agent, paired, g, seen } }
 *         who the links tagged u=<u> were made for (download-links.js tagFor),
 *         and that one's generation g: it goes up each time one of their
 *         links has been used up, so their next list carries fresh links.
 *   used: { <sig>: <exp> }
 *         links whose file was delivered in full; they open nothing again.
 *
 * Entries go once no link made for them can still be open: a used link after
 * its expiry, an identity after two lifetimes without a list.
 */
import fs from "fs";
import path from "path";
import * as env from "../helpers/envs.js";
import debug from "../debug.js";

const FILE = path.join(env.dataDir, "security", "download-links.json");
const EMPTY = Object.freeze({ ids: {}, used: {} });

let state = null;

function load() {
  if (state) return state;
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, "utf8"));
    state = { ids: raw?.ids ?? {}, used: raw?.used ?? {} };
  } catch (err) {
    if (err.code !== "ENOENT") debug.error("download links: %s unreadable, starting empty: %s", FILE, err.message);
    state = EMPTY;
  }
  return state;
}

/** The state without what can no longer matter at `nowMs`. Pure. */
export function pruned({ ids, used }, nowMs, ttlSec) {
  const keepIdMs = 2 * ttlSec * 1000;
  return {
    ids: Object.fromEntries(Object.entries(ids).filter(([, r]) => nowMs - (r.seen ?? 0) <= keepIdMs)),
    used: Object.fromEntries(Object.entries(used).filter(([, exp]) => exp * 1000 >= nowMs)),
  };
}

function commit(next, nowMs) {
  state = pruned(next, nowMs, env.downloadLinkTtl);
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true, mode: 0o700 });
    const tmp = `${FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 });
    fs.renameSync(tmp, FILE);
  } catch (err) {
    debug.error("download links: saving %s failed: %s", FILE, err.message);
  }
}

const sameWho = (a, b) =>
  a.dev === b.dev && a.agent === b.agent && a.paired === b.paired && a.acct?.kind === b.acct?.kind && a.acct?.id === b.acct?.id;

/**
 * Notes that a list is being made for `who` under tag `u`; returns its
 * generation. Written only when something changed or a quarter lifetime passed.
 */
export function remember(u, who, nowMs = Date.now()) {
  const s = load();
  const prev = s.ids[u];
  const fresh = prev && sameWho(prev, who) && nowMs - prev.seen < (env.downloadLinkTtl * 1000) / 4;
  if (fresh) return prev.g;
  const g = prev?.g ?? 0;
  commit({ ...s, ids: { ...s.ids, [u]: { acct: who.acct, dev: who.dev, agent: who.agent, paired: who.paired, g, seen: nowMs } } }, nowMs);
  return g;
}

/** Who the links tagged `u` were made for, or null. */
export function identity(u) {
  const { ids } = load();
  return typeof u === "string" && Object.hasOwn(ids, u) ? ids[u] : null;
}

export function isUsed(sig) {
  return Object.hasOwn(load().used, sig);
}

/** The link is used up; its identity's next lists carry a new generation. */
export function markUsed(sig, exp, u, nowMs = Date.now()) {
  const s = load();
  const who = s.ids[u];
  const ids = who ? { ...s.ids, [u]: { ...who, g: who.g + 1 } } : s.ids;
  commit({ ids, used: { ...s.used, [sig]: exp } }, nowMs);
}

/** Tests read the file again, as after a restart. */
export function resetForTests() {
  state = null;
}
