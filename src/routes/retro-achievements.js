/**
 * RetroAchievements on the retro routes (mounted by routes/retro.js):
 *
 *   GET    /api/retro/achievements/account     { enabled, username }: whether the server has a key, and the name this account registered
 *   PUT    /api/retro/achievements/account     { username }: registers a name RetroAchievements knows (404 when it does not)
 *   DELETE /api/retro/achievements/account     forgets it
 *   GET    /api/retro/achievements/account/lookup?username=   { username } as RetroAchievements spells it (404 when there is no such player)
 *   GET    /api/retro/achievements/games          { user: { username, points } | null, list: [{ gameId, title, system, raGameId, count, points,
 *                                                earned, earnedHardcore, matchedBy, lastEarnedAt, iconUrl }] }: every matched game,
 *                                                one row per RetroAchievements game, the latest earned first, then by title
 *   GET    /api/retro/games/:id/achievements   { raGameId, title, matchedBy, count, points, user, list } (404 when no game matches)
 *   GET    /api/retro/achievements/badge/<n>.png, <n>_lock.png   a badge image, fetched once and kept
 *
 * The console's half of the phone sign-in (retro/achievements/link.js has the envelope):
 *   POST   /api/retro/achievements/link                 { publicKey } → 201 { code, expiresAt, path } (path: the page the QR opens)
 *   GET    /api/retro/achievements/link/<code>/sealed   waits up to 25 s: 200 { epk, iv, ct } (again until the result, if a reply was lost), 204 not yet, 410 gone
 *   POST   /api/retro/achievements/link/<code>/result   { ok, username } or { ok: false, reason?: "unreadable" | "console" } → { state };
 *          ok registers the name, not ok lets the phone try again (unreadable without spending a try);
 *          "console" (the console failed on its own side) ends the link and tells the phone to look at the console
 * A link belongs to the console that opened it (its account and device key).
 *
 * The console signs in to RetroAchievements itself and writes retroarch.cfg;
 * only the public name comes here. A game's own reply carries a short summary
 * (achievementSummary) so it never waits on RetroAchievements.
 */
import crypto from "crypto";
import express from "express";
import fs from "fs/promises";
import path from "path";
import debug from "../debug.js";
import { dataDir } from "../helpers/envs.js";
import { sameOriginWrites } from "../security/same-origin.js";
import { ownerKey } from "../security/link-identity.js";
import * as client from "../retro/achievements/client.js";
import * as players from "../retro/achievements/players.js";
import * as store from "../retro/achievements/store.js";
import * as link from "../retro/achievements/link.js";
import { accountOf } from "../security/link-identity.js";
import { deviceKeyFromHeaders } from "../security/pairing.js";
import * as securityStore from "../security/store.js";
import * as googleAccounts from "../security/google-accounts.js";

export const NAME_RE = /^[A-Za-z0-9_.-]{2,32}$/;
// A console asks again after this; under the 30 s it gives up on a request.
export const LONG_WAIT_MS = 25_000;
// RetroAchievements limits how often the one key may ask; a player's progress is asked again after a minute.
const PLAYER_TTL_MS = 60 * 1000;
const GAME_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX = 500;
const BADGE_RE = /^(\d{1,10}(?:_lock)?)\.png$/;
const BADGE_MAX = 512 * 1024;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const badgeDir = () => path.join(dataDir, "retro-achievements", "badges");
const badgePath = (name, locked = false) => (name ? `/api/retro/achievements/badge/${name}${locked ? "_lock" : ""}.png` : null);

const fetching = new Map(); // file → the fetch in flight, shared by everyone asking for it meanwhile

async function fetchBadge(file, at, fetchImpl) {
  const res = await fetchImpl(client.badgeUrl(file), { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) return null;
  const body = Buffer.from(await res.arrayBuffer());
  if (body.length > BADGE_MAX || !body.subarray(0, 4).equals(PNG_MAGIC)) return null;
  await fs.mkdir(badgeDir(), { recursive: true });
  const tmp = `${at}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tmp, body);
  await fs.rename(tmp, at);
  return body;
}

/** The bytes of a badge (`file` "123" or "123_lock"), from disk or fetched once and saved. */
async function badgeBytes(file, fetchImpl) {
  const at = path.join(badgeDir(), `${file}.png`);
  try {
    return await fs.readFile(at);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  if (!fetching.has(file)) fetching.set(file, fetchBadge(file, at, fetchImpl).finally(() => fetching.delete(file)));
  return fetching.get(file);
}

/** The reply's shape: badges as this server's paths, the RetroAchievements id named apart from ours. */
const forClient = (p, by) => ({
  ...p,
  matchedBy: by,
  list: p.list.map(({ badgeName, ...a }) => ({ ...a, badge: badgePath(badgeName), badgeLocked: badgePath(badgeName, true) })),
});

const progress = new Map(); // "<ra id>:<name>" → { at, value }

async function progressOf(raId, username, opts) {
  const key = `${raId}:${username ?? ""}`;
  const hit = progress.get(key);
  if (hit && Date.now() - hit.at < (username ? PLAYER_TTL_MS : GAME_TTL_MS)) return hit.value;
  const value = await client.gameProgress(raId, username, opts);
  progress.delete(key);
  progress.set(key, { at: Date.now(), value });
  if (progress.size > CACHE_MAX) progress.delete(progress.keys().next().value);
  return value;
}

const playerCache = new Map(); // name → { at, value: { user, earned } }

/** A player's points and per-game counts: 2 calls (more past 500 games), kept a minute. */
async function playerOf(username, opts) {
  const hit = playerCache.get(username);
  if (hit && Date.now() - hit.at < PLAYER_TTL_MS) return hit.value;
  const [user, earned] = await Promise.all([client.playerSummary(username, opts), client.completionProgress(username, opts)]);
  const value = { user, earned };
  playerCache.delete(username);
  playerCache.set(username, { at: Date.now(), value });
  if (playerCache.size > CACHE_MAX) playerCache.delete(playerCache.keys().next().value);
  return value;
}

const NONE = { earned: 0, earnedHardcore: 0, lastEarnedAt: null };

/**
 * One row per RetroAchievements game out of `games` ([{ candidates, shown }], shown() → { id, name, system, iconUrl },
 * asked only of the matched),
 * the first game listed for it kept, a hash match over a title match. Pure but for the stores.
 */
export function matchedRows(games, earned = new Map()) {
  const rows = new Map();
  for (const { candidates, shown } of games) {
    const ra = matchOf(candidates);
    const listed = ra ? store.game(ra.id) : null;
    if (!listed) continue;
    const kept = rows.get(ra.id);
    if (kept && !(kept.matchedBy === "title" && ra.by === "hash")) continue;
    const g = shown();
    rows.set(ra.id, {
      gameId: g.id, title: g.name, system: g.system, raGameId: ra.id, count: listed.count, points: listed.points,
      ...(earned.get(ra.id) ?? NONE), matchedBy: ra.by, iconUrl: g.iconUrl,
    });
  }
  return [...rows.values()].sort((a, b) => (b.lastEarnedAt ?? -1) - (a.lastEarnedAt ?? -1) || a.title.localeCompare(b.title));
}

/** The match of the first of `games` that has one: { id, by }, or null. */
export function matchOf(games) {
  for (const g of games) {
    const ra = store.rom(g.id)?.ra;
    if (ra) return ra;
  }
  return null;
}

/** What a game's own reply says about its achievements, or {} when it has none. */
export function achievementSummary(games) {
  const ra = matchOf(games);
  const listed = ra ? store.game(ra.id) : null;
  return listed ? { achievements: { raGameId: listed.id, count: listed.count, points: listed.points, matchedBy: ra.by } } : {};
}

const ownerOf = (req) => {
  const owner = ownerKey(req);
  return owner === "anonymous" ? null : owner;
};

/** A router for one signed-in owner's requests: req.raOwner, no caching, small JSON bodies. */
function ownerRouter() {
  const r = express.Router();
  r.use(sameOriginWrites());
  r.use(express.json({ limit: "1kb" }));
  r.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    req.raOwner = ownerOf(req);
    // Past the sign-in wall already: a request with no account behind it is refused, not sent to sign in
    // (the web page treats a 401 as a lost session and goes to /login).
    return req.raOwner ? next() : res.status(403).json({ error: "this sign-in has no account" });
  });
  return r;
}

/** An AbortSignal that fires when the client goes away. */
function closedSignal(res) {
  const ac = new AbortController();
  res.on("close", () => ac.abort());
  return ac.signal;
}

const deviceOf = (req) => req.pairedDevice || deviceKeyFromHeaders(req) || null;
// One console: its account and its device key (a request without one is its own browser).
const holderOf = (req) => `${req.raOwner}|${deviceOf(req) ?? "web"}`;

/** Who is asking, as the phone page shows it: { account, device } names, each or null. */
function requesterOf(req) {
  const acct = accountOf(req);
  const account = acct?.kind === "google" ? googleAccounts.maskEmail(googleAccounts.get(acct.id)?.email) : acct?.id ?? null;
  const key = deviceOf(req);
  const device = key ? securityStore.devicesSnapshot().approved.find((d) => d.deviceKey === key)?.label || null : null;
  return { account, device };
}

function mountLink(router) {
  const r = ownerRouter();
  r.post("/", (req, res) => {
    // Only a name a console of this account signed in with is filled in for the phone: a typed one may be anyone's.
    const opened = link.open(holderOf(req), req.body?.publicKey, { requester: requesterOf(req), username: players.provenNameOf(req.raOwner) });
    if (!opened) return res.status(400).json({ error: "publicKey must be an uncompressed P-256 point, base64url" });
    res.status(201).json({ ...opened, path: `/ra-link?c=${opened.code}` });
  });
  r.get("/:code/sealed", async (req, res) => {
    const { code } = req.params;
    if (!link.isHolder(code, holderOf(req))) return res.status(410).json({ error: "no such link" });
    await link.wait(code, (l) => l.state === "sealed" || l.state === "taken", LONG_WAIT_MS, closedSignal(res));
    if (res.writableEnded || res.destroyed) return;
    const envelope = link.take(code, holderOf(req));
    if (envelope === "gone") return res.status(410).json({ error: "no such link" });
    if (envelope === "none") return res.status(204).end();
    res.json(envelope);
  });
  r.post("/:code/result", (req, res) => {
    const ok = req.body?.ok === true;
    const unreadable = !ok && req.body?.reason === "unreadable";
    const stopped = !ok && req.body?.reason === "console";
    const username = typeof req.body?.username === "string" ? req.body.username.trim() : "";
    if (ok && !NAME_RE.test(username)) return res.status(400).json({ error: "invalid username" });
    const state = link.finish(req.params.code, holderOf(req), { ok, unreadable, stopped, username });
    if (!state) return res.status(410).json({ error: "no such link" });
    if (ok) players.register(req.raOwner, username, { proven: true });
    res.json({ state });
  });
  router.use("/achievements/link", r);
}

/**
 * `games(req)` resolves to the listed games as [{ candidates, shown }] (see matchedRows);
 * without it there is no /achievements/games.
 */
export function mountAchievements(router, { fetchImpl = fetch, games = null } = {}) {
  mountLink(router);
  if (games) {
    router.get("/achievements/games", async (req, res, next) => {
      res.set("Cache-Control", "private, no-store");
      try {
        const owner = ownerOf(req);
        const username = owner && client.configured() ? players.nameOf(owner) : null;
        let player = { user: null, earned: new Map() };
        if (username) {
          try {
            player = await playerOf(username, { fetchImpl });
          } catch (err) {
            debug.error("retro achievements: player list: %s", err.message);
            return res.status(502).json({ error: "RetroAchievements did not answer" });
          }
        }
        res.vary("Accept-Language").json({ user: player.user, list: matchedRows(await games(req), player.earned) });
      } catch (err) {
        next(err);
      }
    });
  }
  const account = ownerRouter();
  account.get("/", (req, res) => res.json({ enabled: client.configured(), username: players.nameOf(req.raOwner) }));
  // The name as RetroAchievements spells it, or a reply already sent (400, 503, 404).
  async function knownName(wanted, res) {
    const text = typeof wanted === "string" ? wanted.trim() : "";
    if (!NAME_RE.test(text)) return void res.status(400).json({ error: "invalid username" });
    if (!client.configured()) return void res.status(503).json({ error: "RetroAchievements is not set up on this server" });
    const name = await client.playerName(text, { fetchImpl });
    if (!name) return void res.status(404).json({ error: "no such RetroAchievements player" });
    return name;
  }
  account.get("/lookup", async (req, res, next) => {
    try {
      const name = await knownName(req.query.username, res);
      if (name) res.json({ username: name });
    } catch (err) {
      next(err);
    }
  });
  account.put("/", async (req, res, next) => {
    try {
      const name = await knownName(req.body?.username, res);
      if (!name) return;
      players.register(req.raOwner, name);
      res.json({ enabled: true, username: name });
    } catch (err) {
      next(err);
    }
  });
  account.delete("/", (req, res) => {
    players.unregister(req.raOwner);
    res.json({ enabled: client.configured(), username: null });
  });
  router.use("/achievements/account", account);

  router.get("/achievements/badge/:file", async (req, res) => {
    const file = BADGE_RE.exec(req.params.file)?.[1];
    if (!file) return res.status(404).json({ error: "no such badge" });
    try {
      const body = await badgeBytes(file, fetchImpl);
      if (!body) return res.status(404).json({ error: "no such badge" });
      res.set("Cache-Control", "private, max-age=31536000, immutable").type("png").send(body);
    } catch (err) {
      debug.error("retro achievements: badge %s: %s", file, err.message);
      res.status(502).json({ error: "RetroAchievements did not answer" });
    }
  });

  // `candidates(req)` lists the game and the versions that share its details, best first.
  return function gameAchievements(candidates) {
    return async (req, res) => {
      res.set("Cache-Control", "private, no-store");
      const ra = matchOf(candidates(req));
      if (!ra) return res.status(404).json({ error: "no RetroAchievements game matches" });
      if (!client.configured()) return res.status(503).json({ error: "RetroAchievements is not set up on this server" });
      const owner = ownerOf(req);
      const username = owner ? players.nameOf(owner) : null;
      try {
        res.json(forClient(await progressOf(ra.id, username, { fetchImpl }), ra.by));
      } catch (err) {
        debug.error("retro achievements: game %d: %s", ra.id, err.message);
        res.status(502).json({ error: "RetroAchievements did not answer" });
      }
    };
  };
}

/** For tests. */
export function resetCache() {
  progress.clear();
  playerCache.clear();
}
