/**
 * Every homebrew app in one list for the admin page, each with its own patches
 * and saves, and the changes that list allows.
 *
 *   GET  /admin/api/homebrew/apps          { apps: [{ id, app, name, version, author, size, kind, source, repo_url,
 *                                            patches: [{ id, name, size, files, ko, description, version, author, game_version }],
 *                                            saves: [{ id, name, size, files }] }],
 *                                            held: [{ folder, reason }] }  hand-placed apps kept off the list, and why
 *   POST /admin/api/homebrew/extra/remove  { type: "patch" | "save", id }  deletes a homebrew app's patch or save folder
 *                                          (a patch's information in the patch store goes with it)
 *
 * A homebrew app's patch has its information edited with the game patches' dialog
 * (POST /admin/api/content/patch/meta).
 *   POST /admin/api/homebrew/manual/remove { id }  deletes a hand-placed app's folder (its patches and saves stay)
 */
import fsp from "fs/promises";
import path from "path";
import * as userPatches from "../../meta/user-patches.js";
import * as patchInfo from "../../meta/patch-info.js";
import { patchesDir, savesDir, homebrewDir } from "../../helpers/envs.js";
import { savesCatalog, savesEnabled } from "../saves.js";
import { defaultService, manualApps, refreshManual } from "../homebrew.js";
import { forgetZipCopies, heldManual, installPathFor } from "../../meta/homebrew.js";
import debug from "../../debug.js";

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
      apps: apps.map(({ id, name, version, author, size, kind, enabled, source, repo_url, install_path, file_name, install_type, title_id }) => {
        // The switch/<app>/ folder name, as the public listing gives it; an installable title (.nsp) has none.
        const title = install_type === "title";
        const app = title ? null : (install_path ?? installPathFor(file_name)).split("/")[1];
        return {
          id, app, name, version, author, size, kind, enabled: enabled !== false, source, repo_url,
          install_type: title ? "title" : "file", title_id: title ? title_id : null,
          patches: (app && extras.get(app)?.patches) || [],
          saves: (app && extras.get(app)?.saves) || [],
        };
      }),
      held: heldManual(),
    });
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
    await refreshManual();
    debug.log("admin: removed hand-placed homebrew %s", path.basename(dir));
    res.json({ ok: true });
  }));
}
