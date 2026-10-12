/**
 * Homebrew the server follows on GitHub, managed from the admin page.
 *
 *   GET  /admin/api/homebrew                   { sources: [status], manual: [app], recommended: [{ repo, purpose, added }] }
 *   POST /admin/api/homebrew        { repo, asset? }   follow a repository (owner/name or its address), checked at once
 *   POST /admin/api/homebrew/recommended { repos: [] } follow several from the recommended list (checked in the background)
 *   POST /admin/api/homebrew/asset  { repo, asset }    which release file to use ("" lets the server choose)
 *   POST /admin/api/homebrew/check  { repo? }          check now, ignoring the three-hour wait (all when no repo)
 *   POST /admin/api/homebrew/remove { repo }           stop following it and drop its cached build
 *
 * status = { repo, pattern, tag, released_at, checked_at, assets, chosen, cached, error }
 */
import * as sources from "../../meta/homebrew-sources.js";
import { RECOMMENDED } from "../../meta/homebrew-recommended.js";
import { githubTracker, manualApps, sourcesChanged, refreshManual } from "../homebrew.js";
import debug from "../../debug.js";

const statusOf = (repo) => githubTracker().status().find((s) => s.repo.toLowerCase() === repo.toLowerCase()) ?? null;

export function mountHomebrewApi(router, requireSession) {
  const write = (handler) => async (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store");
    try {
      await handler(req, res);
    } catch (err) {
      if (!(err instanceof sources.SourceError)) {
        debug.error("admin: homebrew change failed: %s", err.message);
        return res.status(500).json({ error: "처리하지 못했습니다. 서버 기록을 봅니다" });
      }
      res.status(400).json({ error: err.message });
    }
  };

  router.get("/api/homebrew", write(async (req, res) => {
    await refreshManual().catch(() => {});
    const followed = new Set(sources.list().map((s) => s.repo.toLowerCase()));
    const manual = (await manualApps()).map(({ id, name, version, author, size, file_name }) => ({ id, name, version, author, size, file_name }));
    res.json({
      sources: githubTracker().status(),
      manual,
      recommended: RECOMMENDED.map((r) => ({ ...r, added: followed.has(r.repo.toLowerCase()) })),
    });
  }));

  router.post("/api/homebrew", write(async (req, res) => {
    const entry = sources.add(req.body?.repo, req.body?.asset);
    await sourcesChanged(entry.repo);
    debug.log("admin: following homebrew %s", entry.repo);
    res.status(201).json(statusOf(entry.repo));
  }));

  router.post("/api/homebrew/recommended", write(async (req, res) => {
    const wanted = Array.isArray(req.body?.repos) ? req.body.repos : RECOMMENDED.map((r) => r.repo);
    const known = new Set(RECOMMENDED.map((r) => r.repo));
    const added = [];
    for (const repo of wanted) if (known.has(repo)) added.push(sources.add(repo).repo);
    await sourcesChanged();
    // First builds can take a while; the page polls the list.
    (async () => { for (const repo of added) await githubTracker().checkNow(repo); })().catch(() => {});
    res.json({ added });
  }));

  router.post("/api/homebrew/asset", write(async (req, res) => {
    if (!sources.setAsset(req.body?.repo, req.body?.asset)) return res.status(404).json({ error: "따라가지 않는 저장소입니다" });
    const repo = sources.list().find((s) => s.repo.toLowerCase() === String(req.body.repo).toLowerCase()).repo;
    await sourcesChanged(repo);
    res.json(statusOf(repo));
  }));

  router.post("/api/homebrew/check", write(async (req, res) => {
    if (req.body?.repo) {
      const s = sources.list().find((x) => x.repo.toLowerCase() === String(req.body.repo).toLowerCase());
      if (!s) return res.status(404).json({ error: "따라가지 않는 저장소입니다" });
      await githubTracker().checkNow(s.repo);
      return res.json(statusOf(s.repo));
    }
    await githubTracker().checkAll({ force: true });
    res.json({ sources: githubTracker().status() });
  }));

  router.post("/api/homebrew/remove", write(async (req, res) => {
    const s = sources.list().find((x) => x.repo.toLowerCase() === String(req.body?.repo ?? "").toLowerCase());
    if (!s || !sources.remove(s.repo)) return res.status(404).json({ error: "따라가지 않는 저장소입니다" });
    await sourcesChanged();
    await githubTracker().forget(s.repo);
    debug.log("admin: stopped following homebrew %s", s.repo);
    res.json({ ok: true });
  }));
}
