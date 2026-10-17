/**
 * The settings tab's client update block (client-release-panel.js):
 *
 *   GET  /admin/api/client-release        { repo, tag, asset, checked_at, fetched, error, offered, rejected }
 *   POST /admin/api/client-release/check  ask GitHub now, ignoring the saved ETag; answers like GET
 *
 * `offered` is the build consoles are told about, wherever it came from (the
 * release, an upload or a file dropped in); `fetched` is the last build taken
 * from the release. The repository itself is the clientReleaseRepo server setting.
 */
import { clientBuildStatus, clientRelease } from "../client-update.js";

const view = (status) => {
  const { published, rejected } = clientBuildStatus();
  return { ...status, offered: published, rejected };
};

export function mountClientReleaseApi(router, requireSession) {
  router.get("/api/client-release", (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store").json(view(clientRelease.status()));
  });
  router.post("/api/client-release/check", async (req, res, next) => {
    if (!requireSession(req, res)) return;
    try {
      res.set("Cache-Control", "no-store").json(view(await clientRelease.check({ force: true })));
    } catch (err) {
      next(err);
    }
  });
}
