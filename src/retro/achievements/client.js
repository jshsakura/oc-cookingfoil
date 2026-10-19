/**
 * The RetroAchievements web API with the server's one key (admin page
 * integrations, or COOK_RA_API_KEY). That key reads any player's public
 * progress by name, so players never hand theirs over.
 * https://api-docs.retroachievements.org/
 */
import * as integrations from "../../security/integrations.js";

const API = "https://retroachievements.org/API";
const MEDIA = "https://media.retroachievements.org";
const TIMEOUT_MS = 15_000;

export class RaError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export const configured = () => integrations.configured("retroAchievements");

async function call(name, params, { fetchImpl = fetch } = {}) {
  const { apiKey } = integrations.get("retroAchievements");
  if (!apiKey) throw new RaError("RetroAchievements key is not set", 503);
  const query = new URLSearchParams({ ...params, y: apiKey });
  const res = await fetchImpl(`${API}/${name}.php?${query}`, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Accept: "application/json" } });
  if (!res.ok) throw new RaError(`HTTP ${res.status} from RetroAchievements`, res.status);
  return res.json();
}

/** Every game of a console that has achievements: [{ id, title, count, points, icon, hashes }]. */
export async function gameList(consoleId, opts) {
  const rows = await call("API_GetGameList", { i: consoleId, f: 1, h: 1 }, opts);
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    id: Number(r.ID),
    title: String(r.Title ?? ""),
    count: Number(r.NumAchievements) || 0,
    points: Number(r.Points) || 0,
    icon: r.ImageIcon ? `${MEDIA}${r.ImageIcon}` : null,
    hashes: Array.isArray(r.Hashes) ? r.Hashes.map((h) => String(h).toLowerCase()) : [],
  })).filter((g) => Number.isInteger(g.id) && g.id > 0);
}

/** The player's name as RetroAchievements spells it, or null when there is no such player. */
export async function playerName(username, opts) {
  try {
    const p = await call("API_GetUserProfile", { u: username }, opts);
    return typeof p?.User === "string" && p.User ? p.User : null;
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

const badge = (name, locked = false) => (name ? `${MEDIA}/Badge/${name}${locked ? "_lock" : ""}.png` : null);

/**
 * A game's achievements, with the player's progress when `username` is given:
 * { gameId, title, count, points, user, list }.
 */
export async function gameProgress(gameId, username, opts) {
  const body = username
    ? await call("API_GetGameInfoAndUserProgress", { g: gameId, u: username }, opts)
    : await call("API_GetGameExtended", { i: gameId }, opts);
  const list = Object.values(body?.Achievements ?? {})
    .sort((a, b) => (Number(a.DisplayOrder) || 0) - (Number(b.DisplayOrder) || 0) || Number(a.ID) - Number(b.ID))
    .map((a) => ({
      id: Number(a.ID),
      title: String(a.Title ?? ""),
      description: String(a.Description ?? ""),
      points: Number(a.Points) || 0,
      badge: badge(a.BadgeName),
      badgeLocked: badge(a.BadgeName, true),
      earned: Boolean(a.DateEarned),
      earnedHardcore: Boolean(a.DateEarnedHardcore),
      earnedAt: a.DateEarnedHardcore || a.DateEarned || null,
    }));
  const earned = list.filter((a) => a.earned);
  return {
    gameId: Number(body?.ID) || Number(gameId),
    title: String(body?.Title ?? ""),
    count: list.length,
    points: list.reduce((n, a) => n + a.points, 0),
    user: username ? {
      username,
      earned: earned.length,
      earnedHardcore: list.filter((a) => a.earnedHardcore).length,
      points: earned.reduce((n, a) => n + a.points, 0),
    } : null,
    list,
  };
}
