/**
 * Every homebrew app in one list for the admin page, each with its own patches
 * and saves, and the changes that list allows.
 *
 *   GET  /admin/api/homebrew/apps          { apps: [{ id, app, name, version, author, size, kind, cores, source, repo_url,
 *                                            patches: [{ id, name, size, files, ko, description, version, author, game_version }],
 *                                            saves: [{ id, name, size, files }] }],
 *                                            held: [{ folder, reason }] }  hand-placed apps kept off the list, and why
 *   POST /admin/api/homebrew/extra/remove  { type: "patch" | "save", id }  deletes a homebrew app's patch or save folder
 *                                          (a patch's information in the patch store goes with it)
 *
 * A homebrew app's patch has its information edited with the game patches' dialog
 * (POST /admin/api/content/patch/meta).
 *   POST /admin/api/homebrew/manual/remove { id }  deletes a hand-placed app's folder and what was added to it by hand (its patches and saves stay)
 *
 * An app's pictures, laid out as a game's (meta/homebrew-media.js); apps carry banner_url, screenshots
 * and media: { banner, shots } (where each came from):
 *   GET  /admin/api/homebrew/banner/candidates?id=&q=   { q, items: [{ game, url, thumb }] } from SteamGridDB
 *   POST /admin/api/homebrew/banner        { id, url, game? }  saves one SteamGridDB picture
 *   POST /admin/api/homebrew/banner/upload?id=   an image body (image/*, at most 15 MB)
 *   POST /admin/api/homebrew/banner/remove { id }  removes it; ports are not filled in again
 *   POST /admin/api/homebrew/shots/upload?id=    one image body, added after the screenshots it has (8 at most)
 *   POST /admin/api/homebrew/shots/remove  { id, n? }  one screenshot (n from 1), or all of them without n
 */
import express from "express";
import fsp from "fs/promises";
import path from "path";
import * as userPatches from "../../meta/user-patches.js";
import * as patchInfo from "../../meta/patch-info.js";
import { patchesDir, savesDir, homebrewDir, publicBaseUrl } from "../../helpers/envs.js";
import { savesCatalog, savesEnabled } from "../saves.js";
import { defaultService, manualApps, refreshManual } from "../homebrew.js";
import { forgetZipCopies, heldManual, installPathFor } from "../../meta/homebrew.js";
import * as media from "../../meta/homebrew-media.js";
import * as integrations from "../../security/integrations.js";
import { resolveOrigin } from "../../helpers/origin.js";
import { forgetExtras } from "../../meta/homebrew-forget.js";
import debug from "../../debug.js";

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

const brief = ({ id, name, size, files }) => ({ id, name, size, files });
// A patch also carries what the edit dialog shows.
const patchBrief = (p) => ({ ...brief(p), homebrew: p.homebrew, ko: p.ko ?? null, description: p.description ?? null, version: p.version ?? null,
  author: p.author ?? null, game_version: p.game_version ?? null });

/** `rel` under `root`, or null when it would leave it. Pure. */
export function inside(root, ...rel) {
  const base = path.resolve(root);
  const target = path.resolve(base, ...rel);
  return target.startsWith(base + path.sep) ? target : null;
}

/** Groups homebrew patches and saves by their app. Pure. */
export function extrasByApp(patches, saves) {
  const out = new Map();
  const add = (app, type, item) => {
    if (!out.has(app)) out.set(app, { patches: [], saves: [] });
    out.get(app)[type].push(type === "patches" ? patchBrief(item) : brief(item));
  };
  for (const p of patches) if (p.homebrew) add(p.homebrew, "patches", p);
  for (const s of saves) if (s.homebrew) add(s.homebrew, "saves", s);
  return out;
}

export function mountHomebrewAppsApi(router, requireSession) {
  const handle = (fn) => async (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store");
    try {
      await fn(req, res);
    } catch (err) {
      debug.error("admin: homebrew apps: %s", err.message);
      res.status(500).json({ error: "처리하지 못했습니다. 서버 기록을 봅니다" });
    }
  };

  router.get("/api/homebrew/apps", handle(async (req, res) => {
    const [apps, patches, saves] = await Promise.all([
      defaultService.list("ko"),
      userPatches.list(),
      savesEnabled() ? savesCatalog().list() : [],
    ]);
    const extras = extrasByApp(patches, saves);
    res.json({
      apps: apps.map(({ id, name, version, author, size, kind, forwarder_cores, enabled, source, repo_url, install_path, file_name, install_type, title_id }) => {
        // The switch/<app>/ folder name, as the public listing gives it; an installable title (.nsp) has none.
        const title = install_type === "title";
        const app = title ? null : (install_path ?? installPathFor(file_name)).split("/")[1];
        return {
          id, app, name, version, author, size, kind, cores: forwarder_cores ?? 4, enabled: enabled !== false, source, repo_url,
          install_type: title ? "title" : "file", title_id: title ? title_id : null,
          ...media.urls(id), media: { banner: media.record(id).banner?.source ?? null, shots: media.record(id).shots?.source ?? null },
          patches: (app && extras.get(app)?.patches) || [],
          saves: (app && extras.get(app)?.saves) || [],
        };
      }),
      held: heldManual(),
    });
  }));

  // The app must be on the list: a picture is never written for an id that names nothing.
  const appOf = async (id) => (await defaultService.list("ko")).find((e) => e.id === String(id ?? "")) ?? null;
  const imageError = (res, err) => {
    if (err instanceof media.MediaImageError) return res.status(400).json({ error: err.message });
    throw err;
  };

  router.get("/api/homebrew/banner/candidates", handle(async (req, res) => {
    const { apiKey } = integrations.get("steamgriddb");
    if (!apiKey) return res.status(409).json({ error: "SteamGridDB 키가 없습니다. 연동 탭에서 넣습니다" });
    const app = await appOf(req.query.id);
    if (!app) return res.status(404).json({ error: "목록에 없는 앱입니다" });
    const q = String(req.query.q ?? "").trim().slice(0, 100) || media.searchNames(app)[0] || app.name;
    res.json({ q, items: await media.bannerCandidates(q, apiKey) });
  }));

  router.post("/api/homebrew/banner", handle(async (req, res) => {
    const app = await appOf(req.body?.id);
    if (!app) return res.status(404).json({ error: "목록에 없는 앱입니다" });
    const g = req.body?.game;
    const game = g && Number.isSafeInteger(Number(g.id)) ? { id: Number(g.id), name: String(g.name ?? "").slice(0, 200) } : null;
    try {
      await media.saveBannerFromSgdb(app.id, String(req.body?.url ?? ""), game);
    } catch (err) {
      if (/SteamGridDB 이미지 주소가 아닙니다/.test(err.message)) return res.status(400).json({ error: err.message });
      return imageError(res, err);
    }
    debug.log("admin: homebrew %s banner from SteamGridDB", app.id);
    res.json({ ok: true });
  }));

  const imageBody = express.raw({ type: "image/*", limit: MAX_IMAGE_BYTES });
  /** The app and the image body of an upload, or null once an answer has gone out. The session is checked first. */
  const readUpload = async (req, res) => {
    const origin = req.get("Origin");
    if (origin && origin !== resolveOrigin(req, publicBaseUrl)) return void res.status(403).json({ error: "origin mismatch" });
    const app = await appOf(req.query.id);
    if (!app) return void res.status(404).json({ error: "목록에 없는 앱입니다" });
    const bad = await new Promise((resolve) => imageBody(req, res, resolve));
    if (bad) return void res.status(bad.type === "entity.too.large" ? 413 : 400).json({ error: bad.type === "entity.too.large" ? "15 MB 보다 큰 이미지는 받지 않습니다" : "이미지를 받지 못했습니다" });
    if (!Buffer.isBuffer(req.body) || !req.body.length) return void res.status(415).json({ error: "이미지 파일을 올립니다" });
    return { app, raw: req.body };
  };

  router.post("/api/homebrew/banner/upload", handle(async (req, res) => {
    const up = await readUpload(req, res);
    if (!up) return;
    try {
      const bytes = await media.saveBanner(up.app.id, up.raw, { source: "upload" });
      debug.log("admin: homebrew %s banner uploaded (%d → %d bytes)", up.app.id, up.raw.length, bytes);
      res.json({ ok: true, bytes });
    } catch (err) {
      imageError(res, err);
    }
  }));

  router.post("/api/homebrew/shots/upload", handle(async (req, res) => {
    const up = await readUpload(req, res);
    if (!up) return;
    try {
      res.json({ ok: true, count: await media.addShots(up.app.id, [up.raw]) });
    } catch (err) {
      imageError(res, err);
    }
  }));

  router.post("/api/homebrew/shots/remove", handle(async (req, res) => {
    const app = await appOf(req.body?.id);
    if (!app) return res.status(404).json({ error: "목록에 없는 앱입니다" });
    const n = req.body?.n == null ? null : Number(req.body.n);
    if (n !== null && !Number.isInteger(n)) return res.status(400).json({ error: "없는 스크린샷입니다" });
    try {
      res.json({ ok: true, count: await media.removeShots(app.id, n) });
    } catch (err) {
      imageError(res, err);
    }
  }));

  router.post("/api/homebrew/banner/remove", handle(async (req, res) => {
    const app = await appOf(req.body?.id);
    if (!app) return res.status(404).json({ error: "목록에 없는 앱입니다" });
    await media.removeBanner(app.id);
    res.json({ ok: true });
  }));

  router.post("/api/homebrew/extra/remove", handle(async (req, res) => {
    const type = req.body?.type;
    const id = String(req.body?.id ?? "");
    if (type !== "patch" && type !== "save") return res.status(400).json({ error: "patch 나 save 여야 합니다" });
    const where = type === "patch" ? userPatches.locate(id) : savesEnabled() ? await savesCatalog().locate(id) : null;
    // Only a homebrew app's own folder (homebrew/<app>/<name>) is removed here.
    const dir = where && where.dir.startsWith("homebrew/") ? inside(type === "patch" ? patchesDir : savesDir, where.dir, where.folder) : null;
    if (!dir) return res.status(404).json({ error: "목록에 없는 항목입니다" });
    await fsp.rm(dir, { recursive: true, force: true });
    if (type === "patch") {
      patchInfo.remove(where.key);
      await userPatches.scan();
    }
    else savesCatalog().invalidate();
    debug.log("admin: removed homebrew %s %s/%s", type, where.dir, where.folder);
    res.json({ ok: true });
  }));

  router.post("/api/homebrew/manual/remove", handle(async (req, res) => {
    const id = String(req.body?.id ?? "");
    const app = (await manualApps()).find((m) => m.id === id);
    const dir = app ? (app.folder ?? path.dirname(app.path)) : null;
    // The app's own folder, directly under the homebrew folder.
    if (!dir || path.dirname(dir) !== path.resolve(homebrewDir)) return res.status(404).json({ error: "직접 넣은 앱 목록에 없습니다" });
    await fsp.rm(dir, { recursive: true, force: true });
    await forgetZipCopies(id);
    await forgetExtras(id);
    await refreshManual();
    debug.log("admin: removed hand-placed homebrew %s", path.basename(dir));
    res.json({ ok: true });
  }));
}
