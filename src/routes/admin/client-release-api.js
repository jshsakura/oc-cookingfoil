/**
 * The settings tab's client build block (client-release-panel.js):
 *
 *   GET  /admin/api/client-release        { mode, repo, tag, asset, checked_at, fetched, error, offered, rejected, manual, github }
 *   POST /admin/api/client-release/check  read both files again and, in "github" mode, ask GitHub now
 *                                         (ignoring the saved ETag); answers like GET
 *
 * `offered` is the build consoles are told about, with its `source` ("manual"
 * or "github"); `manual` and `github` are the version each file holds;
 * `fetched` is the last build taken from the release. The mode and the release
 * are the clientSource, clientReleaseRepo, clientReleaseTag and
 * clientReleaseAsset server settings.
 */
import { clientBuildStatus, clientRelease, latestBuild } from "../client-update.js";

const view = (status) => {
  const { published, rejected, mode, manual, github } = clientBuildStatus();
  return { ...status, mode, offered: published, rejected, manual, github };
};

export function mountClientReleaseApi(router, requireSession) {
  router.get("/api/client-release", (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store").json(view(clientRelease.status()));
  });
  router.post("/api/client-release/check", async (req, res, next) => {
    if (!requireSession(req, res)) return;
    try {
      const status = await clientRelease.check({ force: true });
      await latestBuild();
      res.set("Cache-Control", "no-store").json(view(status));
    } catch (err) {
      next(err);
    }
  });
}
