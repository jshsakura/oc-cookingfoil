/**
 * Game patches on the admin page:
 *
 *   GET  /admin/api/patches            { patches: [{ id, title_id, game, name, size, files, required }] }
 *   POST /admin/api/patches/required   { id, required: boolean }  marks a patch the game does not start without
 *
 * `required` lives in the patch's patch.json, beside the rest of its metadata.
 */
import fsp from "fs/promises";
import * as userPatches from "../../meta/user-patches.js";
import { patchesDir } from "../../helpers/envs.js";
import { inside } from "./homebrew-apps-api.js";
import { libraryGames } from "./upload-api.js";
import debug from "../../debug.js";

/** patch.json with `required` set or cleared; other fields kept as they are. Pure. */
export function withRequired(meta, required) {
  const { required: _old, ...rest } = meta && typeof meta === "object" && !Array.isArray(meta) ? meta : {};
  return required ? { ...rest, required: true } : rest;
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
    const [patches, games] = await Promise.all([userPatches.list(), libraryGames().catch(() => [])]);
    const names = new Map(games.map((g) => [g.titleId, g.name]));
    res.json({
      patches: patches.filter((p) => p.title_id).map(({ id, title_id, name, size, files, required }) =>
        ({ id, title_id, game: names.get(title_id) ?? null, name, size, files, required })),
    });
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
