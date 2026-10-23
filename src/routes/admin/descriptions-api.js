/**
 * What the admin writes about a game, which titledb and metadata refreshes never
 * overwrite (kept apart, one game.json per game: meta/game-descriptions.js). /api/title/{id} answers
 * the admin's description in place of titledb's, and their notes as `notes`:
 *
 *   GET  /admin/api/descriptions/<title id>    { titleId, own: { name, description, notes } | null, original }
 *   POST /admin/api/descriptions/<title id>    { name?, description?, notes? }, each plain text (Korean when it
 *                                              has Hangul, else English) or { <client language>: text }: the languages sent
 *                                              are saved, one sent empty is forgotten; an unknown language
 *                                              key or a text too long is refused with 400
 *   POST /admin/api/descriptions/<title id>/reset   { field?: "description" | "notes" }  (none: both)
 */
import * as gameDescriptions from "../../meta/game-descriptions.js";
import * as titledbStore from "../../meta/titledb-store.js";
import * as shopCache from "../../meta/shop-cache.js";
import * as extractedMeta from "../../meta/extracted-meta-store.js";
import debug from "../../debug.js";
import { requestLang } from "../../meta/langs.js";
import { apiWord } from "./api-words.js";

const ID_RE = /^[0-9A-F]{16}$/;

export function mountDescriptionsApi(router, requireSession) {
  const handle = (fn) => async (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store");
    try {
      await fn(req, res);
    } catch (err) {
      debug.error("admin: descriptions: %s", err.message);
      res.status(500).json({ error: apiWord(req, "failed") });
    }
  };
  const idOf = (req, res) => {
    const id = String(req.params.id ?? "").toUpperCase();
    if (ID_RE.test(id)) return id;
    res.status(400).json({ error: apiWord(req, "descriptions.badTitle") });
    return null;
  };

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
    for (const field of gameDescriptions.FIELDS) {
      const problem = gameDescriptions.checkInput(field, req.body?.[field], requestLang(req));
      if (problem) return res.status(400).json({ error: problem });
    }
    for (const field of gameDescriptions.FIELDS) {
      const v = req.body?.[field];
      if (v != null) gameDescriptions.set(id, field, v);
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
