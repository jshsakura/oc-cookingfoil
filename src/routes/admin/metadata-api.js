/**
 * What the library's metadata still needs, for the admin's 메타데이터 › 검토 필요 page and the
 * metadata_review capability:
 *
 *   GET /admin/api/metadata/review   { game: { total, items: [{ titleId, name, reasons }] },
 *                                      retro: { missingArt, guesses },
 *                                      patch: { total, items: [{ id, titleId, name }] } }
 *
 * A game's reasons: "garbled" (its name has a replacement or control character), "noName" (no name, or only
 * its title ID), "noKo" (no Korean name from titledb or the admin). A patch is listed when no game is known
 * for its title ID. Retro sends counts only: its own views list the games.
 */
import debug from "../../debug.js";
import { retroDir } from "../../helpers/envs.js";
import { libraryGames } from "../../meta/library-games.js";
import { garbled } from "../../meta/nacp-decode.js";
import * as titledbStore from "../../meta/titledb-store.js";
import * as userPatches from "../../meta/user-patches.js";
import { gameOf } from "../../meta/game-info.js";
import * as retroCatalog from "../../retro/catalog.js";
import { overview } from "../../retro/art/admin.js";
import { retroKoReview } from "./retro-ko-api.js";
import { apiWord } from "./api-words.js";

const LIST_MAX = 500;

/** The reasons a game's name needs the admin, in the order the page shows them. */
export function gameReasons({ titleId, name }, names) {
  const reasons = [];
  if (name && garbled(name)) reasons.push("garbled");
  if (!name || name.toUpperCase() === titleId) reasons.push("noName");
  if (!names?.ko) reasons.push("noKo");
  return reasons;
}

async function retroCounts() {
  try {
    const catalog = await retroCatalog.current(retroDir);
    const { guessesTotal } = await retroKoReview("ko", 0);
    return { missingArt: overview(catalog).missing.length, guesses: guessesTotal };
  } catch (err) {
    debug.error("admin: metadata review: retro: %s", err.message);
    return { missingArt: 0, guesses: 0 };
  }
}

/** The review lists, each capped at `max` with its whole count beside it. */
export async function metadataReview(max = LIST_MAX) {
  const [games, patches, retro] = await Promise.all([libraryGames().catch(() => []), userPatches.list(), retroCounts()]);
  const game = games
    .map((g) => ({ titleId: g.titleId, name: g.name, reasons: gameReasons(g, titledbStore.namesOf(g.titleId)) }))
    .filter((g) => g.reasons.length)
    // Broken names first: they show wrong everywhere, a missing Korean name only to Korean readers.
    .sort((a, b) => (a.reasons[0] === "noKo") - (b.reasons[0] === "noKo") || a.name.localeCompare(b.name));
  const known = new Set(games.map((g) => g.titleId));
  const patch = patches
    .filter((p) => p.title_id && !known.has(p.title_id) && !gameOf(p.title_id))
    .map((p) => ({ id: p.id, titleId: p.title_id, name: p.ko ?? p.name }));
  return {
    game: { total: game.length, items: game.slice(0, max) },
    retro,
    patch: { total: patch.length, items: patch.slice(0, max) },
  };
}

export function mountMetadataApi(router, requireSession) {
  router.get("/api/metadata/review", async (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store");
    try {
      res.json(await metadataReview());
    } catch (err) {
      debug.error("admin: metadata review: %s", err.message);
      res.status(500).json({ error: apiWord(req, "failed") });
    }
  });
}
