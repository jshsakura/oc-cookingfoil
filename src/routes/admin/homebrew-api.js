/**
 * Homebrew the server follows on GitHub, managed from the admin page.
 *
 *   GET  /admin/api/homebrew                   { sources: [status], manual: [app], recommended: [{ repo, purpose, added }] }
 *   POST /admin/api/homebrew        { repo, asset? }   follow a repository (owner/name or its address), checked at once
 *   POST /admin/api/homebrew/recommended { repos: [] } follow several from the recommended list (checked in the background)
 *   POST /admin/api/homebrew/asset  { repo, asset }    which release file to use ("" lets the server choose)
 *   POST /admin/api/homebrew/check  { repo? }          check now, ignoring the check interval (all when no repo)
 *   POST /admin/api/homebrew/adopt                    register the folders put in the homebrew folder by hand  { registered, skipped }
 *   POST /admin/api/homebrew/rescan                   read every hand-placed app again now (in the background; the activity menu shows it)
 *   POST /admin/api/homebrew/remove { repo }           stop following it and drop its cached build and what was added by hand (pictures, description, kind)
 *   POST /admin/api/homebrew/enabled { id, enabled }   show the app to clients or leave it out (kept on the server)
 *   POST /admin/api/homebrew/verified { id, verified } marks the app as tried on a console (the library shows a 검수됨 badge), or not
 *   POST /admin/api/homebrew/cores  { id, cores }      CPU cores its HOME-menu shortcut may use: 3 (default) or 4; the shortcut is built again at once
 *   POST /admin/api/homebrew/description       { id, en, ko }  the app's description (empty = none)
 *   POST /admin/api/homebrew/description/reset { id }          back to the GitHub repository's own
 *
 * verified, cores, kind and enabled go through meta/item-fields.js, as an admin
 * device's changes do, so each change is written to the history (admin-edits.jsonl).
 *
 * status = { id, repo, pattern, tag, released_at, checked_at, assets, chosen, cached, error,
 *            description: { custom: { en, ko } | null, github } }
 */
import * as sources from "../../meta/homebrew-sources.js";
import * as kinds from "../../meta/homebrew-kinds.js";
import * as cores from "../../meta/homebrew-cores.js";
import * as verified from "../../meta/homebrew-verified.js";
import * as descriptions from "../../meta/homebrew-descriptions.js";
import { RECOMMENDED } from "../../meta/homebrew-recommended.js";
import { githubTracker, manualApps, sourcesChanged, refreshManual, totalSize } from "../homebrew.js";
import { adoptFolders } from "../../meta/homebrew.js";
import { homebrewDir } from "../../helpers/envs.js";
import { forgetExtras } from "../../meta/homebrew-forget.js";
import { setField, FieldError } from "../../meta/item-fields.js";
import debug from "../../debug.js";
import { apiWord } from "./api-words.js";
import { metaError, metaErrorText } from "../../meta/meta-messages.js";
import { requestLang } from "../../meta/langs.js";

const withDescription = ({ repo_description: github, ...s }) => ({ ...s, kind: kinds.kindOf(s.id), description: { custom: descriptions.get(s.id), github } });
const statuses = () => githubTracker().status().map(withDescription);
const DASHBOARD = { via: "dashboard", device: null, deviceName: null };
const statusOf = (repo) => statuses().find((s) => s.repo.toLowerCase() === repo.toLowerCase()) ?? null;

export function mountHomebrewApi(router, requireSession) {
  const write = (handler) => async (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store");
    try {
      await handler(req, res);
    } catch (err) {
      // An installable title has no shortcut, so no cores to set: 400 from item-fields.
      if (err instanceof FieldError) return res.status(err.status).json({ error: err.message });
      if (!(err instanceof sources.SourceError)) {
        debug.error("admin: homebrew change failed: %s", err.message);
        return res.status(500).json({ error: apiWord(req, "failed") });
      }
      res.status(400).json(metaError(req, err));
    }
  };

  router.get("/api/homebrew", write(async (req, res) => {
    await refreshManual().catch((err) => debug.error("homebrew: manual rescan failed: %s", err.message));
    const followed = new Set(sources.list().map((s) => s.repo.toLowerCase()));
    const manual = (await manualApps()).map(({ id, name, version, author, file_name, ...e }) => ({
      id, name, version, author, size: totalSize(e), file_name, kind: kinds.kindOf(id), description: { custom: descriptions.get(id), github: null },
    }));
    res.json({
      sources: statuses(),
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
    (async () => { for (const repo of added) await githubTracker().checkNow(repo); })().catch((err) => debug.error("homebrew: check of new repos failed: %s", err.message));
    res.json({ added });
  }));

  router.post("/api/homebrew/asset", write(async (req, res) => {
    if (!sources.setAsset(req.body?.repo, req.body?.asset)) return res.status(404).json({ error: apiWord(req, "homebrew.noRepo") });
    const repo = sources.list().find((s) => s.repo.toLowerCase() === String(req.body.repo).toLowerCase()).repo;
    await sourcesChanged(repo);
    res.json(statusOf(repo));
  }));

  router.post("/api/homebrew/check", write(async (req, res) => {
    if (req.body?.repo) {
      const s = sources.list().find((x) => x.repo.toLowerCase() === String(req.body.repo).toLowerCase());
      if (!s) return res.status(404).json({ error: apiWord(req, "homebrew.noRepo") });
      await githubTracker().checkNow(s.repo);
      return res.json(statusOf(s.repo));
    }
    await githubTracker().checkAll({ force: true });
    res.json({ sources: statuses() });
  }));

  /** Whether `id` is an app this server lists (followed or hand-placed). */
  const known = async (id) => statuses().some((s) => s.id === id) || (await manualApps()).some((m) => m.id === id);

  router.post("/api/homebrew/description", write(async (req, res) => {
    const id = String(req.body?.id ?? "");
    if (!(await known(id))) return res.status(404).json({ error: apiWord(req, "homebrew.noApp") });
    descriptions.set(id, { en: req.body?.en, ko: req.body?.ko });
    res.json({ ok: true, custom: descriptions.get(id) });
  }));

  router.post("/api/homebrew/cores", write(async (req, res) => {
    const id = String(req.body?.id ?? "");
    if (!(await known(id))) return res.status(404).json({ error: apiWord(req, "homebrew.noApp") });
    const want = Number(req.body?.cores);
    if (!cores.CORES.includes(want)) return res.status(400).json({ error: apiWord(req, "homebrew.badCores") });
    // item-fields builds the shortcut again at once, so the list carries the new shortcut's address.
    await setField("homebrew", id, "cores", String(want), DASHBOARD);
    debug.log("admin: homebrew %s shortcut cores %d", id, cores.coresOf(id));
    res.json({ ok: true, cores: cores.coresOf(id) });
  }));

  router.post("/api/homebrew/verified", write(async (req, res) => {
    const id = String(req.body?.id ?? "");
    if (!(await known(id))) return res.status(404).json({ error: apiWord(req, "homebrew.noApp") });
    if (typeof req.body?.verified !== "boolean") return res.status(400).json({ error: apiWord(req, "field.bool", { field: "verified" }) });
    await setField("homebrew", id, "verified", req.body.verified, DASHBOARD);
    debug.log("admin: homebrew %s %s", id, req.body.verified ? "verified" : "no longer verified");
    res.json({ ok: true, ...verified.fields(id) });
  }));

  router.post("/api/homebrew/kind", write(async (req, res) => {
    const id = String(req.body?.id ?? "");
    if (!(await known(id))) return res.status(404).json({ error: apiWord(req, "homebrew.noApp") });
    if (!kinds.KINDS.includes(String(req.body?.kind ?? ""))) return res.status(400).json({ error: apiWord(req, "homebrew.badKind") });
    await setField("homebrew", id, "kind", String(req.body.kind), DASHBOARD);
    res.json({ ok: true, kind: kinds.kindOf(id) });
  }));

  router.post("/api/homebrew/enabled", write(async (req, res) => {
    const id = String(req.body?.id ?? "");
    if (typeof req.body?.enabled !== "boolean") return res.status(400).json({ error: apiWord(req, "field.bool", { field: "enabled" }) });
    if (!(await known(id))) return res.status(404).json({ error: apiWord(req, "homebrew.noApp") });
    await setField("homebrew", id, "enabled", req.body.enabled, DASHBOARD);
    debug.log("admin: homebrew %s %s", id, req.body.enabled ? "on" : "off");
    res.json({ ok: true, enabled: req.body.enabled });
  }));

  router.post("/api/homebrew/description/reset", write(async (req, res) => {
    descriptions.reset(String(req.body?.id ?? ""));
    res.json({ ok: true });
  }));

  // Folder installs change files several folders down, which the folder watch does not follow:
  // after copying files in by hand the admin asks for a read here.
  router.post("/api/homebrew/rescan", write(async (_req, res) => {
    refreshManual().catch((err) => debug.error("admin: homebrew rescan failed: %s", err.message));
    debug.log("admin: homebrew rescan requested");
    res.json({ ok: true });
  }));

  router.post("/api/homebrew/adopt", write(async (req, res) => {
    const result = await adoptFolders(homebrewDir);
    await refreshManual();
    debug.log("admin: homebrew folders registered: %s", result.registered.join(", ") || "none");
    const lang = requestLang(req);
    res.json({ ...result, skipped: result.skipped.map(({ folder, reason, code, vars }) => ({ folder, reason: metaErrorText(lang, { message: reason, code, vars }), ...(code ? { code } : {}) })) });
  }));

  router.post("/api/homebrew/remove", write(async (req, res) => {
    const s = sources.list().find((x) => x.repo.toLowerCase() === String(req.body?.repo ?? "").toLowerCase());
    if (!s) return res.status(404).json({ error: apiWord(req, "homebrew.noRepo") });
    const id = statusOf(s.repo)?.id;
    if (!sources.remove(s.repo)) return res.status(404).json({ error: apiWord(req, "homebrew.noRepo") });
    await sourcesChanged();
    await githubTracker().forget(s.repo);
    // The pictures, description and kind put on it by hand go with it.
    if (id) await forgetExtras(id);
    debug.log("admin: stopped following homebrew %s", s.repo);
    res.json({ ok: true });
  }));
}
