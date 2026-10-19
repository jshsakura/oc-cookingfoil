/**
 * RetroAchievements on the retro routes (mounted by routes/retro.js):
 *
 *   GET    /api/retro/achievements/account     { enabled, username }: whether the server has a key, and the name this account registered
 *   PUT    /api/retro/achievements/account     { username }: registers a name RetroAchievements knows (404 when it does not)
 *   DELETE /api/retro/achievements/account     forgets it
 *   GET    /api/retro/games/:id/achievements   { raGameId, title, matchedBy, count, points, user, list } (404 when no game matches)
 *   GET    /api/retro/achievements/badge/<n>.png, <n>_lock.png   a badge image, fetched once and kept
 *
 * The console signs in to RetroAchievements itself and writes retroarch.cfg;
 * only the public name comes here. A game's own reply carries a short summary
 * (achievementSummary) so it never waits on RetroAchievements.
 */
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

const NAME_RE = /^[A-Za-z0-9_.-]{2,32}$/;
// RetroAchievements limits how often the one key may ask; a player's progress is asked again after a minute.
const PLAYER_TTL_MS = 60 * 1000;
const GAME_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX = 500;
const BADGE_RE = /^(\d{1,10}(?:_lock)?)\.png$/;
const BADGE_MAX = 512 * 1024;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const badgeDir = () => path.join(dataDir, "retro-achievements", "badges");
const badgePath = (name, locked = false) => (name ? `/api/retro/achievements/badge/${name}${locked ? "_lock" : ""}.png` : null);

/** The bytes of a badge (`file` "123" or "123_lock"), from disk or fetched once and saved. */
async function badgeBytes(file, fetchImpl) {
  const at = path.join(badgeDir(), `${file}.png`);
  try {
    return await fs.readFile(at);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  const res = await fetchImpl(client.badgeUrl(file), { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) return null;
  const body = Buffer.from(await res.arrayBuffer());
  if (body.length > BADGE_MAX || !body.subarray(0, 4).equals(PNG_MAGIC)) return null;
  await fs.mkdir(badgeDir(), { recursive: true });
  await fs.writeFile(`${at}.tmp`, body);
  await fs.rename(`${at}.tmp`, at);
  return body;
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

export function mountAchievements(router, { fetchImpl = fetch } = {}) {
  const account = express.Router();
  account.use(sameOriginWrites());
  account.use(express.json({ limit: "1kb" }));
  account.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    req.raOwner = ownerOf(req);
    return req.raOwner ? next() : res.status(401).json({ error: "sign in first" });
  });
  account.get("/", (req, res) => res.json({ enabled: client.configured(), username: players.nameOf(req.raOwner) }));
  account.put("/", async (req, res, next) => {
    try {
      const wanted = typeof req.body?.username === "string" ? req.body.username.trim() : "";
      if (!NAME_RE.test(wanted)) return res.status(400).json({ error: "invalid username" });
      if (!client.configured()) return res.status(503).json({ error: "RetroAchievements is not set up on this server" });
      const name = await client.playerName(wanted, { fetchImpl });
      if (!name) return res.status(404).json({ error: "no such RetroAchievements player" });
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
}
