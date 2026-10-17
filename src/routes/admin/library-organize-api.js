/**
 * The games folder's drop box (meta/library-organize.js) on the admin page:
 *
 *   GET  /admin/api/library/organize        { incoming, sweptAt, error, running, held, heldCount, waiting, recent }
 *   POST /admin/api/library/organize/sweep  sort the drop box now; answers with the view after it
 */
import * as env from "../../helpers/envs.js";
import * as shopCache from "../../meta/shop-cache.js";
import * as titledb from "../../meta/titledb-store.js";
import * as activity from "../../tasks/activity.js";
import { readIdentity } from "../../meta/content-meta.js";
import { readPfs0Entries } from "../../meta/pfs0.js";
import { createOrganizer } from "../../meta/library-organize.js";
import debug from "../../debug.js";

export const defaultOrganizer = createOrganizer({
  romsDir: env.romsDirPath,
  romsRels: async () => {
    await shopCache.get();
    return shopCache.files().map((f) => f.rel);
  },
  readIdentity,
  readTicketNames: async (abs) => (await readPfs0Entries(abs))?.map((e) => e.name) ?? null,
  nameOf: (tid) => {
    const names = titledb.namesOf(tid);
    return names?.ko || names?.en || titledb.get(tid)?.name || null;
  },
  begin: activity.begin,
  rescan: () => shopCache.invalidate({ rescan: true }),
});

export function mountLibraryOrganizeApi(router, requireSession, organizer = defaultOrganizer) {
  const handle = (fn) => async (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store");
    try {
      await fn(req, res);
    } catch (err) {
      debug.error("admin: organize: %s", err.message);
      res.status(500).json({ error: "처리하지 못했습니다. 서버 기록을 봅니다" });
    }
  };

  router.get("/api/library/organize", handle((req, res) => res.json(organizer.view())));

  router.post("/api/library/organize/sweep", handle(async (req, res) => {
    const { moved } = await organizer.sweep();
    debug.log("admin: organize: moved %d", moved);
    res.json({ moved, ...organizer.view() });
  }));
}
