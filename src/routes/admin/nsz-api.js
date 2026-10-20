/**
 * The 변환 tab's NSZ conversion queue (meta/nsz-queue.js):
 *
 *   GET    /admin/api/nsz?filter=&offset=&limit=   { status, totals, active, items, total, settings, … }
 *                                                  filter: all | waiting | running | done | failed
 *   GET    /admin/api/nsz/preview                  { files, bytes } a 전체 변환 would process
 *   POST   /admin/api/nsz/start                    start or resume       409 while the queue is off
 *   POST   /admin/api/nsz/run-selected { ids }     run only these waiting rows, then stop
 *                                                  409 while the queue is off, 400 when none of them waits
 *   POST   /admin/api/nsz/run-waiting              run the rows waiting now (not ones queued later), then stop
 *                                                  409 while the queue is off, 400 when nothing waits
 *   POST   /admin/api/nsz/pause                    stop the running files; they wait again
 *   POST   /admin/api/nsz/scan                     queue every eligible file in the library
 *   POST   /admin/api/nsz/convert-all              scan, then start      409 while the queue is off
 *   POST   /admin/api/nsz/items/:id/top            move to the front
 *   POST   /admin/api/nsz/items/:id/retry          a failed or skipped one waits again ("all" for every one)
 *   DELETE /admin/api/nsz/items/:id                take it out (not queued by itself again), with its kept original
 *   POST   /admin/api/nsz/purge-kept               delete every kept original now   { removed, bytes }
 *   POST   /admin/api/nsz/clear-finished           drop the done and skipped rows and their kept originals
 *   GET    /admin/api/nsz/log?offset=&limit=&q=     the conversion log, newest first
 *
 * The settings are server settings (nsz*), saved through /admin/api/server-settings.
 */
import * as serverSettings from "../../security/server-settings.js";
import nszQueue from "../../meta/nsz-service.js";
import debug from "../../debug.js";

const ID_RE = /^[0-9a-f]{12}$/;
const OFF = { error: "off", message: "변환이 꺼져 있습니다. 아래 설정에서 먼저 켭니다." };
const MAX_SELECTED = 1000;

function nszSettings() {
  const all = serverSettings.describe();
  return Object.fromEntries(Object.entries(all).filter(([k]) => k.startsWith("nsz")));
}

export function mountNszApi(router, requireSession, queue = nszQueue) {
  const handle = (fn) => async (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store");
    try {
      await fn(req, res);
    } catch (err) {
      debug.error("admin: nsz: %s", err.message);
      res.status(500).json({ error: "처리하지 못했습니다. 서버 기록을 봅니다" });
    }
  };
  const view = (q = {}) => ({ ...queue.view({ filter: String(q.filter ?? "all"), offset: q.offset, limit: q.limit }), settings: nszSettings() });
  const item = (fn) => handle(async (req, res) => {
    const id = String(req.params.id);
    if (id !== "all" && !ID_RE.test(id)) return res.status(404).json({ error: "대기열에 없는 항목입니다" });
    if (!(await fn(id))) return res.status(404).json({ error: "대기열에 없는 항목입니다" });
    res.json({ ok: true });
  });

  router.get("/api/nsz", handle((req, res) => res.json(view(req.query))));
  router.get("/api/nsz/preview", handle(async (req, res) => res.json(await queue.preview())));

  router.post("/api/nsz/start", handle((req, res) => {
    if (!queue.view({ limit: 1 }).enabled) return res.status(409).json(OFF);
    queue.start();
    res.json({ ok: true });
  }));
  router.post("/api/nsz/run-selected", handle((req, res) => {
    const ids = req.body?.ids;
    if (!Array.isArray(ids) || !ids.length || ids.length > MAX_SELECTED || !ids.every((id) => typeof id === "string" && ID_RE.test(id))) {
      return res.status(400).json({ error: "변환할 파일을 고릅니다" });
    }
    if (!queue.view({ limit: 1 }).enabled) return res.status(409).json(OFF);
    const n = queue.runSelected(ids);
    if (!n) return res.status(400).json({ error: "고른 파일 중 대기 중인 것이 없습니다" });
    res.json({ ok: true, count: n });
  }));
  router.post("/api/nsz/run-waiting", handle((req, res) => {
    if (!queue.view({ limit: 1 }).enabled) return res.status(409).json(OFF);
    const n = queue.runWaiting();
    if (!n) return res.status(400).json({ error: "대기 중인 파일이 없습니다" });
    res.json({ ok: true, count: n });
  }));
  router.post("/api/nsz/pause", handle(async (req, res) => {
    await queue.pause();
    res.json({ ok: true });
  }));
  router.post("/api/nsz/scan", handle(async (req, res) => res.json({ ok: true, ...(await queue.scan()) })));
  router.post("/api/nsz/convert-all", handle(async (req, res) => {
    if (!queue.view({ limit: 1 }).enabled) return res.status(409).json(OFF);
    const r = await queue.scan();
    queue.start();
    res.json({ ok: true, ...r });
  }));
  router.post("/api/nsz/items/:id/top", item((id) => id !== "all" && queue.moveTop(id)));
  router.post("/api/nsz/items/:id/retry", item((id) => queue.retry(id) > 0 || id === "all"));
  router.delete("/api/nsz/items/:id", item((id) => id !== "all" && queue.remove(id)));
  router.post("/api/nsz/purge-kept", handle(async (req, res) => res.json({ ok: true, ...(await queue.purgeKept()) })));
  router.get("/api/nsz/log", handle((req, res) => res.json(queue.logPage({ offset: req.query.offset, limit: req.query.limit, q: String(req.query.q ?? "").slice(0, 200) }))));
  router.post("/api/nsz/clear-finished", handle(async (req, res) => res.json({ ok: true, removed: await queue.clearFinished() })));
}
