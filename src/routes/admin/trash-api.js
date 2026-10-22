/**
 * The shared trash and the operations journal, from the admin page's 휴지통 tab:
 *
 *   GET  /admin/api/trash                  { items: [{ id, root, kind, action, by, name, trashedAt, ageDays, size, items, missing }],
 *                                            total: { bytes, count }, roots: { <folder>: { bytes, count } }, noticeDays, old }
 *   POST /admin/api/trash/restore          { ids }   put entries back; a taken place gets a numbered name beside it
 *                                          → { restored: [{ id, name, items, renamed }], failed: [{ id, error }] }
 *   POST /admin/api/trash/empty            { ids | all: true, confirm: "empty" }  deletes for good   → { removed, bytes }
 *   GET  /admin/api/trash/journal?limit=   { items: [{ id, at, action, by, fromRoot, from, toRoot, to, undoable, reason, undone }], total }
 *   POST /admin/api/trash/undo             { id }    moves a journaled file back → { from, to }
 *
 * Emptying is the only permanent delete the server has, so only a person on the
 * admin page may (admin-page.js TOKEN_BLOCKED_RE refuses it to automation tokens);
 * listing, restoring and undoing are open to them. Nothing empties by itself.
 */
import debug from "../../debug.js";
import * as trash from "../../library/trash-service.js";

const MAX_IDS = 1000;
const ID_MAX = 300;

/** The ids of a request body, or null when they are not a list of short strings. Pure. */
export function idsOf(body) {
  const ids = body?.ids;
  if (!Array.isArray(ids) || !ids.length || ids.length > MAX_IDS) return null;
  return ids.every((id) => typeof id === "string" && id.length > 0 && id.length <= ID_MAX) ? [...new Set(ids)] : null;
}

export function mountTrashApi(router, requireSession, service = trash) {
  const handle = (fn) => async (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store");
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof service.TrashError) return res.status(err.status ?? 409).json({ error: err.message });
      debug.error("admin: trash: %s", err.message);
      res.status(500).json({ error: "처리하지 못했습니다. 서버 기록을 봅니다" });
    }
  };

  router.get("/api/trash", handle(async (req, res) => res.json(await service.list())));

  router.post("/api/trash/restore", handle(async (req, res) => {
    const ids = idsOf(req.body);
    if (!ids) return res.status(400).json({ error: "되돌릴 항목을 고릅니다" });
    res.json({ ok: true, ...(await service.restore(ids, service.actorOf(req))) });
  }));

  router.post("/api/trash/empty", handle(async (req, res) => {
    // The page asks the person to type the word first; the API wants the same proof it was meant.
    if (req.body?.confirm !== "empty") return res.status(400).json({ error: "비우려면 confirm 에 \"empty\" 를 넣습니다" });
    const ids = req.body?.all === true ? "all" : idsOf(req.body);
    if (!ids) return res.status(400).json({ error: "비울 항목을 고릅니다" });
    res.json({ ok: true, ...(await service.empty(ids, service.actorOf(req))) });
  }));

  router.get("/api/trash/journal", handle(async (req, res) => {
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 200, 1), 1000);
    res.json(await service.journal({ limit }));
  }));

  router.post("/api/trash/undo", handle(async (req, res) => {
    const id = typeof req.body?.id === "string" ? req.body.id : "";
    if (!id || id.length > ID_MAX) return res.status(400).json({ error: "되돌릴 작업을 고릅니다" });
    res.json({ ok: true, ...(await service.undo(id, service.actorOf(req))) });
  }));
}
