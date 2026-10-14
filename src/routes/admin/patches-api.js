/**
 * Game patches on the admin page:
 *
 *   GET  /admin/api/patches            { patches: [{ id, title_id, game, name, ko, description, version, author, size, files, required,
 *                                         game_version, update_version, update_in_library }] }
 *   GET  /admin/api/patches/updates?titleId=  { updates: [{ version, date, display, in_library }] }  newest first
 *   POST /admin/api/patches/required   { id, required: boolean }  marks a patch the game does not start without
 *
 * `update_version` is the update a patch was made for. It is a reference: the
 * admin sees when the library lacks that update, nothing is hidden or held back.
 *
 * `required` lives in the patch's patch.json, beside the rest of its metadata.
 */
import fsp from "fs/promises";
import * as userPatches from "../../meta/user-patches.js";
import { patchesDir } from "../../helpers/envs.js";
import { inside } from "./homebrew-apps-api.js";
import { libraryGames } from "./upload-api.js";
import * as shopCache from "../../meta/shop-cache.js";
import * as titledbVersions from "../../meta/titledb-versions.js";
import debug from "../../debug.js";

/** patch.json with `required` set or cleared; other fields kept as they are. Pure. */
export function withRequired(meta, required) {
  const { required: _old, ...rest } = meta && typeof meta === "object" && !Array.isArray(meta) ? meta : {};
  return required ? { ...rest, required: true } : rest;
}

// A shop name ends in "[<title id>][v<version>]".
const VERSION_RE = /\[v(\d+)\]$/;

/**
 * One game's updates: those the eShop published (titledb) and those in the
 * library, newest first, with the display version ("1.0.32.0") a library file
 * carries. Pure.
 */
export function updateChoices(base, history, files) {
  const byVersion = new Map(history.map(({ version, date }) => [version, { version, date: date ?? null, display: null, in_library: false }]));
  for (const f of files) {
    if (f?.kind !== "update" || f.baseTitleId !== base) continue;
    const version = Number(VERSION_RE.exec(f.name ?? "")?.[1]);
    if (!version) continue;
    const known = byVersion.get(version) ?? { version, date: null, display: null, in_library: false };
    byVersion.set(version, { ...known, display: f.version_name ?? known.display, in_library: true });
  }
  return [...byVersion.values()].sort((a, b) => b.version - a.version);
}

/** Every update version the library holds, per base title id. Pure. */
export function libraryUpdates(files) {
  const out = new Map();
  for (const f of files) {
    const version = f?.kind === "update" ? Number(VERSION_RE.exec(f.name ?? "")?.[1]) : 0;
    if (!version || !f.baseTitleId) continue;
    if (!out.has(f.baseTitleId)) out.set(f.baseTitleId, new Set());
    out.get(f.baseTitleId).add(version);
  }
  return out;
}

const libraryFiles = async () => (await shopCache.get().catch(() => null))?.files ?? [];

export function mountPatchesApi(router, requireSession) {
  const handle = (fn) => async (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store");
    try {
      await fn(req, res);
    } catch (err) {
      debug.error("admin: patches: %s", err.message);
      res.status(500).json({ error: "처리하지 못했습니다. 서버 기록을 봅니다" });
    }
  };

  router.get("/api/patches", handle(async (req, res) => {
    const [patches, games, files] = await Promise.all([userPatches.list(), libraryGames().catch(() => []), libraryFiles()]);
    const names = new Map(games.map((g) => [g.titleId, g.name]));
    const owned = libraryUpdates(files);
    res.json({
      patches: patches.filter((p) => p.title_id).map(({ id, title_id, name, ko, description, version, author, size, files, required, game_version, update_version }) =>
        ({ id, title_id, game: names.get(title_id) ?? null, name, ko: ko ?? null, description, version, author, size, files, required,
          game_version: game_version ?? null, update_version: update_version ?? null,
          update_in_library: update_version ? Boolean(owned.get(title_id)?.has(update_version)) : null })),
    });
  }));

  router.get("/api/patches/updates", handle(async (req, res) => {
    const base = String(req.query.titleId ?? "").toUpperCase();
    if (!/^[0-9A-F]{16}$/.test(base)) return res.status(400).json({ error: "titleId 는 16자리 타이틀 ID 입니다" });
    res.json({ updates: updateChoices(base, titledbVersions.updateHistory(base), await libraryFiles()) });
  }));

  router.post("/api/patches/required", handle(async (req, res) => {
    const id = String(req.body?.id ?? "");
    if (typeof req.body?.required !== "boolean") return res.status(400).json({ error: "required 는 true 나 false 입니다" });
    const where = userPatches.locate(id);
    const dir = where && !where.dir.startsWith("homebrew/") ? inside(patchesDir, where.dir, where.folder) : null;
    if (!dir) return res.status(404).json({ error: "목록에 없는 패치입니다" });
    const file = `${dir}/patch.json`;
    let meta = {};
    try {
      meta = JSON.parse(await fsp.readFile(file, "utf8"));
    } catch (err) {
      if (err.code !== "ENOENT") return res.status(409).json({ error: "patch.json 을 읽지 못했습니다. 파일을 고친 뒤 다시 합니다" });
    }
    await fsp.writeFile(file, `${JSON.stringify(withRequired(meta, req.body.required), null, 1)}\n`);
    await userPatches.scan();
    debug.log("admin: patch %s/%s required=%s", where.dir, where.folder, req.body.required);
    res.json({ ok: true });
  }));
}
