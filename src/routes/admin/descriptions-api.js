/**
 * What the admin writes about a game, which titledb and metadata refreshes never
 * overwrite (kept apart, one game.json per game: meta/game-descriptions.js). /api/title/{id} answers
 * the admin's description in place of titledb's, and their notes as `notes`:
 *
 *   GET  /admin/api/descriptions               { games: [{ titleId, name, edited }] }   library games
 *   GET  /admin/api/descriptions/<title id>    { titleId, own: { description, notes } | null, original }
 *   POST /admin/api/descriptions/<title id>    { description?: { en, ko }, notes?: { en, ko } }
 *                                              a field sent is saved; both languages empty forgets it
 *   POST /admin/api/descriptions/<title id>/reset   { field?: "description" | "notes" }  (none: both)
 */
import * as gameDescriptions from "../../meta/game-descriptions.js";
import * as titledbStore from "../../meta/titledb-store.js";
import * as shopCache from "../../meta/shop-cache.js";
import * as extractedMeta from "../../meta/extracted-meta-store.js";
import { libraryGames } from "./upload-api.js";
import debug from "../../debug.js";

const ID_RE = /^[0-9A-F]{16}$/;

export function mountDescriptionsApi(router, requireSession) {
  const handle = (fn) => async (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store");
    try {
      await fn(req, res);
    } catch (err) {
      debug.error("admin: descriptions: %s", err.message);
      res.status(500).json({ error: "처리하지 못했습니다. 서버 기록을 봅니다" });
    }
  };
  const idOf = (req, res) => {
    const id = String(req.params.id ?? "").toUpperCase();
    if (ID_RE.test(id)) return id;
    res.status(400).json({ error: "타이틀 ID 는 16자리 16진수입니다" });
    return null;
  };

  router.get("/api/descriptions", handle(async (req, res) => {
    const edited = new Set(gameDescriptions.edited());
    const games = await libraryGames().catch(() => []);
    res.json({ games: games.map((g) => ({ ...g, edited: edited.has(g.titleId) })) });
  }));

  router.get("/api/descriptions/:id", handle(async (req, res) => {
    const id = idOf(req, res);
    if (!id) return;
    const original = titledbStore.get(id)?.description ?? extractedMeta.get(id)?.description ?? null;
    const originalName = titledbStore.get(id)?.name ?? extractedMeta.get(id)?.name ?? null;
    res.json({ titleId: id, own: gameDescriptions.get(id), original, originalName });
  }));

  router.post("/api/descriptions/:id", handle(async (req, res) => {
    const id = idOf(req, res);
    if (!id) return;
    const text = (v) => (typeof v === "string" ? v : null);
    for (const field of gameDescriptions.FIELDS) {
      const v = req.body?.[field];
      if (v && typeof v === "object") gameDescriptions.set(id, field, { en: text(v.en), ko: text(v.ko) });
    }
    // A changed name is baked into the list the server hands out: build it again.
    if (req.body?.name) shopCache.invalidate({ rename: true });
    debug.log("admin: description of %s saved", id);
    res.json({ titleId: id, own: gameDescriptions.get(id) });
  }));

  router.post("/api/descriptions/:id/reset", handle(async (req, res) => {
    const id = idOf(req, res);
    if (!id) return;
    const field = gameDescriptions.FIELDS.includes(req.body?.field) ? req.body.field : null;
    gameDescriptions.reset(id, field);
    if (!field || field === "name") shopCache.invalidate({ rename: true });
    res.json({ titleId: id, own: gameDescriptions.get(id) });
  }));
}
