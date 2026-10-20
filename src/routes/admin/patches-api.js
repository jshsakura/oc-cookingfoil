/**
 * Game patches on the admin page:
 *
 *   GET  /admin/api/patches            { patches: [{ id, title_id, game, name, ko, description, version, author, size, files, required,
 *                                         game_version, update_version, update_in_library }] }
 *   GET  /admin/api/patches/updates?titleId=  { updates: [{ version, date, display, in_library }] }  newest first
 *   POST /admin/api/patches/required   { id, required: boolean }  marks a patch the game does not start without
 *   GET  /admin/api/patches/info       { patches: [{ id, key, title_id, homebrew, stored, info }], missing: [{ key, missing_since }] }
 *                                      every patch, a game's or a homebrew app's, with its information; `stored` is
 *                                      false while it shows the defaults; `missing` are entries kept for folders gone
 *   PUT  /admin/api/patches/:id/info   { name, version?, game_version?, update_version?, author?, description?,
 *                                        required?, ko?: { name?, description? } }  → { id, info }
 *                                      replaces the text fields; `required`, `update_version` and `game_version`
 *                                      stay as they were when left out. Limits as in meta/patch-info.js.
 *
 * `update_version` is the update a patch was made for. It is a reference: the
 * admin sees when the library lacks that update, nothing is hidden or held back.
 *
 * A patch's information, `required` with it, lives in the server's patch
 * store (meta/patch-info.js), never in its patch.json. An edit shows in the
 * lists at once: they lay the store over the scanned folders when served.
 */
import * as userPatches from "../../meta/user-patches.js";
import * as patchInfo from "../../meta/patch-info.js";
import { libraryGames } from "./upload-api.js";
import * as shopCache from "../../meta/shop-cache.js";
import * as titledbVersions from "../../meta/titledb-versions.js";
import { gameOf } from "../../meta/game-info.js";
import * as itemVerified from "../../meta/item-verified.js";
import debug from "../../debug.js";

/** Information with `required` set or cleared; other fields kept as they are. Pure. */
export function withRequired(meta, required) {
  const { required: _old, ...rest } = meta && typeof meta === "object" && !Array.isArray(meta) ? meta : {};
  return required ? { ...rest, required: true } : rest;
}

/**
 * A patch's information after an edit, validated: the text fields as sent,
 * `required`, `update_version` and `game_version` kept from `old` when the
 * edit leaves them out. Throws patchInfo.InfoError. Pure.
 */
export function editedInfo(old, input) {
  const body = input && typeof input === "object" && !Array.isArray(input) ? { ...input } : input;
  if (body && typeof body === "object") {
    if (body.required === undefined) body.required = old?.required === true;
    for (const k of ["update_version", "game_version"]) if (!(k in body)) body[k] = old?.[k];
  }
  return patchInfo.validate(body);
}

/**
 * One game's updates: those the eShop published (titledb) and those in the
 * library, newest first, with the display version ("1.0.32.0") a library file
 * carries. Pure.
 */
export function updateChoices(base, history, files) {
  const byVersion = new Map(history.map(({ version, date }) => [version, { version, date: date ?? null, display: null, in_library: false }]));
  for (const f of files) {
    if (f?.kind !== "update" || f.baseTitleId !== base) continue;
    const version = f.version;
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
    const version = f?.kind === "update" ? f.version : 0;
    if (!version || !f.baseTitleId) continue;
    if (!out.has(f.baseTitleId)) out.set(f.baseTitleId, new Set());
    out.get(f.baseTitleId).add(version);
  }
  return out;
}

const libraryFiles = async () => {
  await shopCache.get().catch(() => null);
  return shopCache.files();
};

/** A game the library does not hold is still named from titledb or the patch's own files (Korean first). */
function nameOf(titleId) {
  const game = gameOf(titleId);
  return game ? game.names?.ko ?? game.name : null;
}

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
        ({ id, title_id, game: names.get(title_id) ?? nameOf(title_id), name, ko: ko ?? null, description, version, author, size, files, required,
          game_version: game_version ?? null, update_version: update_version ?? null,
          update_in_library: update_version ? Boolean(owned.get(title_id)?.has(update_version)) : null,
          verified: itemVerified.verifiedAt("patch", id) !== null })),
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
    if (!where?.key || where.dir.startsWith("homebrew/")) return res.status(404).json({ error: "목록에 없는 패치입니다" });
    patchInfo.set(where.key, withRequired(userPatches.infoOf(id), req.body.required));
    debug.log("admin: patch %s required=%s", where.key, req.body.required);
    shopCache.invalidate(); // the game's card and the consoles' shop carry required_patches
    res.json({ ok: true });
  }));

  router.get("/api/patches/info", handle(async (req, res) => {
    const listed = await userPatches.list();
    const keys = new Set();
    const patches = listed.map((p) => {
      const where = userPatches.locate(p.id);
      if (where?.key) keys.add(where.key);
      return { id: p.id, key: where?.key ?? null, title_id: p.title_id, homebrew: p.homebrew ?? null,
        stored: Boolean(where?.key && patchInfo.has(where.key)), info: userPatches.infoOf(p.id) };
    });
    const missing = patchInfo.entries().filter((e) => e.missing_since && !keys.has(e.key)).map(({ key, missing_since }) => ({ key, missing_since }));
    res.json({ patches, missing });
  }));

  router.put("/api/patches/:id/info", handle(async (req, res) => {
    const id = String(req.params.id ?? "");
    const where = userPatches.locate(id);
    if (!where?.key) return res.status(404).json({ error: "목록에 없는 패치입니다" });
    let info;
    try {
      info = editedInfo(userPatches.infoOf(id), req.body);
    } catch (err) {
      if (err instanceof patchInfo.InfoError) return res.status(400).json({ error: err.message });
      throw err;
    }
    patchInfo.set(where.key, info);
    debug.log("admin: patch %s edited", where.key);
    res.json({ id, info: patchInfo.get(where.key) });
  }));
}
