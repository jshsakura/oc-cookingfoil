/**
 * Game trailers collected from IGDB (meta/igdb-videos.js), for the web's game
 * detail as an admin sees it. Web-only: index.js mounts this behind
 * adminOnly({ reads: true }), so consoles and user accounts are refused, and
 * nothing a console reads (/api/title, the library sections, /api/retro/*) carries them.
 *
 *   GET /api/videos/title/<16 hex>   { videos: [{ id, name }] }   a Switch game; a Korean
 *                                    release borrows its sibling's, as the scores do
 *   GET /api/videos/retro/<game id>  { videos: [{ id, name }] }   a retro game; 404 for no such game
 */
import express from "express";
import * as ratingSync from "../meta/rating-sync.js";
import * as titledbStore from "../meta/titledb-store.js";
import { retroVideos } from "./retro.js";

const TITLE_RE = /^[0-9A-F]{16}$/;

/** A Switch game's trailers: its own, else the first sibling's that has any. */
function titleTrailers(id) {
  // The admin's own list (game.json) would take precedence here once it can be edited.
  for (const tid of [id, ...titledbStore.artSiblings(id)]) {
    const videos = ratingSync.trailersOf(tid);
    if (videos.length) return videos;
  }
  return [];
}

export default function videosRouter() {
  const router = express.Router();
  router.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  router.get("/title/:id", (req, res) => {
    const id = String(req.params.id).toUpperCase();
    if (!TITLE_RE.test(id)) return res.status(400).json({ error: "bad title id" });
    res.json({ videos: titleTrailers(id) });
  });
  router.get("/retro/:id", (req, res, next) => {
    retroVideos(req.params.id)
      .then((videos) => (videos ? res.json({ videos }) : res.status(404).json({ error: "no such game" })))
      .catch(next);
  });
  return router;
}
