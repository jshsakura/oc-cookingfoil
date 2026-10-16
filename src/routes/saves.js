/**
 * Save files the shop hands out (see meta/shop-saves.js). Off (404) until the
 * saves folder (COOK_SAVES_DIR, default /saves) exists.
 *
 *   GET /api/saves?lang=ko          { saves: [{ id, titleId, name, description, gameVersion, source,
 *                                     size, files, updatedAt, hash, game?, url }] }, with ETag.
 *                                   Korean text for ko (?lang= or Accept-Language) when a save
 *                                   has it, English otherwise; source is { name, url? } or null
 *                                   A homebrew app's save has titleId null, `homebrew` (its
 *                                   switch/<app>/ folder name) and `installRoot` ("switch/<app>"):
 *                                   its files are restored into that folder of the SD card
 *                                   url is on the direct address for a client that asked for it
 *                                   (security/download-links.js)
 *   GET /api/saves?view=games       one row per game instead: { games: [{ key, titleId, homebrew?,
 *                                     game?, count, size, updatedAt }] }, with ETag. `key` is the
 *                                     title id, or "hb:<app>" for a homebrew app
 *   GET /api/saves?game=<key>       only that game's saves, in the shape above
 *   GET /api/saves/:id/download     the save folder's contents as an uncompressed ustar,
 *                                   paths relative to the save's root, directories first
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import express from "express";
import { savesDir, dataDir, publicBaseUrl } from "../helpers/envs.js";
import { createCatalog, localize } from "../meta/shop-saves.js";
import { requestLang } from "../meta/categories.js";
import { gameOf } from "../meta/game-info.js";
import { resolveOrigin } from "../helpers/origin.js";
import { sendTar } from "../helpers/tar-stream.js";
import { directUrl, forRequest } from "../security/download-links.js";

const ID_RE = /^([0-9A-F]{16}|hb-[0-9a-f]{12})-[0-9a-f]{12}$/;

export const savesEnabled = () => fs.existsSync(savesDir);

/** The game a save belongs to: its title id, or "hb:<app>" for a homebrew app's save. Pure. */
export const gameKey = (s) => s.titleId ?? `hb:${s.homebrew}`;

/** One row per game, in listing order: how many saves, their total size and the newest. */
export function byGame(saves, origin = "") {
  const rows = new Map();
  for (const s of saves) {
    const key = gameKey(s);
    let row = rows.get(key);
    if (!row) {
      const game = s.titleId ? gameOf(s.titleId, origin) : null;
      row = { key, titleId: s.titleId ?? null, ...(s.homebrew ? { homebrew: s.homebrew } : {}), ...(game ? { game } : {}), count: 0, size: 0, updatedAt: 0 };
      rows.set(key, row);
    }
    row.count++;
    row.size += s.size;
    row.updatedAt = Math.max(row.updatedAt, s.updatedAt ?? 0);
  }
  return [...rows.values()];
}

let shared = null;
/** The one catalog of the saves folder, shared with the admin page. */
export const savesCatalog = () => (shared ??= createCatalog({ root: savesDir, cacheFile: path.join(dataDir, "saves-hashes.json"), listFile: path.join(dataDir, "saves-list.json") }));

const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);

export default function savesRouter() {
  const router = express.Router();
  const catalog = savesCatalog();

  router.use((req, res, next) => (savesEnabled() ? next() : res.status(404).json({ error: "this shop hands out no save files" })));

  router.get("/", wrap(async (req, res) => {
    const origin = resolveOrigin(req, publicBaseUrl);
    const lang = requestLang(req);
    const link = forRequest(req);
    const want = typeof req.query.game === "string" ? req.query.game : null;
    const all = (await catalog.list()).filter((s) => !want || gameKey(s) === want);
    let body;
    if (req.query.view === "games") {
      body = JSON.stringify({ games: byGame(all, origin) });
    } else {
      const saves = all.map((s) => {
        const game = s.titleId ? gameOf(s.titleId, origin) : null;
        return { ...localize(s, lang), ...(game ? { game } : {}), url: directUrl(`/api/saves/${s.id}/download`, link) };
      });
      body = JSON.stringify({ saves });
    }
    res.type("application/json");
    res.set("ETag", `"${crypto.createHash("sha1").update(body).digest("hex")}"`);
    res.set("Cache-Control", "private, max-age=0, must-revalidate");
    res.set("Vary", "Accept-Language");
    if (req.fresh) return res.status(304).end();
    res.status(200).end(body);
  }));

  router.get("/:id/download", wrap(async (req, res) => {
    const id = String(req.params.id ?? "");
    if (!ID_RE.test(id)) return res.status(400).json({ error: "invalid save id" });
    const opened = await catalog.open(id);
    if (!opened) return res.status(404).json({ error: "no such save" });
    sendTar(res, opened.entries, { filename: `${id}.tar`, etag: opened.save.hash, label: "saves", fixedTimes: true });
  }));

  return router;
}
