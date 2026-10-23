/**
 * The admin page's 임시 공유 tab: what signed-in users left in the share inbox.
 *
 *   GET    /admin/api/inbox?show=open|done|all   { entries: [{ id, user, at, memo, links, files: [{ name, size, sha256, url }], bytes, done }],
 *                                                  usage, quota, maxBytes, enabled }   newest first; open by default
 *   GET    /admin/api/inbox/:id/file?path=        one file, as a download
 *   POST   /admin/api/inbox/:id/done              { done: true|false }  set aside as 정리함 (or back), nothing deleted
 *   DELETE /admin/api/inbox/:id                   delete the entry and its files
 *
 * Only paths inside the inbox are ever read or removed (meta/inbox.js checks
 * the id's shape and that a file stays inside its entry's files/).
 */
import path from "path";
import * as inbox from "../../meta/inbox.js";
import * as envs from "../../helpers/envs.js";
import { resolveOrigin } from "../../helpers/origin.js";
import debug from "../../debug.js";
import { apiWord } from "./api-words.js";
import { actorOf } from "../../library/trash-service.js";

const SHOW = { open: false, done: true, all: undefined };

export function mountInboxApi(router, requireSession) {
  const handle = (fn) => async (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store");
    if (req.method !== "GET") {
      const origin = req.get("Origin");
      if (origin && origin !== resolveOrigin(req, envs.publicBaseUrl)) return res.status(403).json({ error: "origin mismatch" });
    }
    try {
      await fn(req, res);
    } catch (err) {
      debug.error("admin: inbox: %s", err.message);
      res.status(500).json({ error: apiWord(req, "failed") });
    }
  };
  const fileUrl = (id, name) => `/admin/api/inbox/${id}/file?path=${encodeURIComponent(name)}`;

  router.get("/api/inbox", handle(async (req, res) => {
    const show = String(req.query.show ?? "open");
    const entries = await inbox.list({ done: show in SHOW ? SHOW[show] : false });
    res.json({
      entries: entries.map((e) => ({ ...e, files: e.files.map((f) => ({ ...f, url: fileUrl(e.id, f.name) })) })),
      usage: await inbox.usage(),
      quota: envs.inboxQuotaBytes,
      maxBytes: envs.inboxMaxBytes,
      enabled: envs.inboxEnabled,
    });
  }));

  router.get("/api/inbox/:id/file", handle((req, res) => {
    const abs = inbox.filePath(req.params.id, String(req.query.path ?? ""));
    if (!abs) return res.status(404).json({ error: apiWord(req, "inbox.noFile") });
    res.download(abs, path.basename(abs), { dotfiles: "allow" });
  }));

  router.post("/api/inbox/:id/done", handle(async (req, res) => {
    if (!(await inbox.setDone(req.params.id, req.body?.done === true))) return res.status(404).json({ error: apiWord(req, "inbox.noItem") });
    debug.log("admin: inbox %s %s", req.params.id, req.body?.done === true ? "set aside" : "back to open");
    res.json({ ok: true });
  }));

  router.delete("/api/inbox/:id", handle(async (req, res) => {
    if (!(await inbox.remove(req.params.id, { by: actorOf(req) }))) return res.status(404).json({ error: apiWord(req, "inbox.noItem") });
    debug.log("admin: inbox %s deleted", req.params.id);
    res.json({ ok: true });
  }));
}
