/**
 * IGDB for the retro games LaunchBox has nothing on, when IGDB keys are set:
 * one search per game on its system's IGDB platforms, accepted only for a
 * near-exact title (rating-sync's similarity ≥ 0.9). A miss is remembered so
 * it is asked again only after MISS_TTL_MS.
 */
import * as igdb from "../../meta/igdb-client.js";
import { bestMatch } from "../../meta/rating-sync.js";
import { fromIgdb } from "./fields.js";
import { VIDEO_FIELDS } from "../../meta/igdb-videos.js";

const MATCH_MIN = 0.9;
export const MISS_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** IGDB platform ids per system. */
export const IGDB_PLATFORMS = {
  nes: [18, 99, 51], snes: [19, 58], gb: [33], gbc: [22], gba: [24], n64: [4], nds: [20],
  md: [29], sms: [64], gg: [35], segacd: [78], saturn: [32], pce: [86], pcecd: [150],
  ps1: [7], psp: [38], ngp: [119, 120], ws: [57, 123], arcade: [52], neocd: [136], "32x": [30],
  sg: [84], a2600: [59], a7800: [60], lynx: [61], col: [68], videopac: [133], msx: [27, 53],
  amstrad: [25], c64: [15], zxs: [26], vb: [87],
};

const FIELDS = [
  "name", "summary", "first_release_date", "genres.name",
  "involved_companies.company.name", "involved_companies.developer", "involved_companies.publisher",
  "multiplayer_modes.offlinemax", "multiplayer_modes.offlinecoopmax", "game_modes.slug", "screenshots.image_id",
  VIDEO_FIELDS,
].join(",");

export const configured = () => igdb.configured();

/** A record for a game by its titles, or { source: "igdb", miss: true }. */
export async function igdbMeta(system, titles, { fetchImpl = fetch } = {}) {
  const platforms = IGDB_PLATFORMS[system];
  if (!platforms || !titles.length) return { source: "igdb", miss: true };
  const term = titles[0].replace(/\s*[([][^)\]]*[)\]]/g, "").replace(/"/g, "").trim();
  const body = `search "${term}"; fields ${FIELDS}; where platforms = (${platforms.join(",")}); limit 5;`;
  const games = await igdb.query("games", body, { fetchImpl });
  const best = bestMatch(titles, Array.isArray(games) ? games : []);
  if (!best || best.confidence < MATCH_MIN) return { source: "igdb", miss: true };
  return fromIgdb(best.item);
}
