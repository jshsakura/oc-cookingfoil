/**
 * The 변환 tab's NSZ conversion queue (meta/nsz-queue.js):
 *
 *   GET    /admin/api/nsz?filter=&offset=&limit=   { status, totals, active, items, total, settings, … }
 *                                                  filter: all | waiting | running | done | failed
 *   GET    /admin/api/nsz/preview                  { files, bytes } a 전체 변환 would process
 *   POST   /admin/api/nsz/start                    start or resume       409 while the queue is off
 *   POST   /admin/api/nsz/pause                    stop the running files; they wait again
 *   POST   /admin/api/nsz/scan                     queue every eligible file in the library
 *   POST   /admin/api/nsz/convert-all              scan, then start      409 while the queue is off
 *   POST   /admin/api/nsz/items/:id/top            move to the front
 *   POST   /admin/api/nsz/items/:id/retry          a failed or skipped one waits again ("all" for every one)
 *   DELETE /admin/api/nsz/items/:id                take it out (not queued by itself again)
 *   POST   /admin/api/nsz/clear-finished           drop the done and skipped rows
 *
 * The settings are server settings (nsz*), saved through /admin/api/server-settings.
 */
import * as serverSettings from "../../security/server-settings.js";
import nszQueue from "../../meta/nsz-service.js";
import debug from "../../debug.js";

const ID_RE = /^[0-9a-f]{12}$/;
const OFF = { error: "off", message: "변환이 꺼져 있습니다. 아래 설정에서 먼저 켭니다." };

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
  router.post("/api/nsz/clear-finished", handle((req, res) => res.json({ ok: true, removed: queue.clearFinished() })));
}
