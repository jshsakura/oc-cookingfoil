/**
 * /api/inbox — the temporary share inbox (임시 공유) for people signed in on
 * the web page. They leave files, a memo and links; the operator gets a
 * Telegram alert and sorts them later from the admin page or the folder.
 *
 *   GET  /api/inbox   { enabled, maxBytes, freeBytes }
 *   POST /api/inbox   multipart + X-CSRF-Token:
 *                       files   zero or more files
 *                       paths   JSON list of folder-relative paths, one per file, when a folder was picked
 *                       memo    text, up to 10,000 characters
 *                       links   http/https addresses, one per line, up to 20
 *                     → 201 { ok, id, files, bytes }
 *
 *   400 { code: empty | bad-link | too-many-links | memo-too-long }  nothing given, or a field that doesn't fit
 *   401 not signed in on the web (a console's Basic sign-in doesn't count)
 *   403 another site's origin, or the CSRF token is missing or wrong
 *   404 the inbox is switched off (settings tab)
 *   413 the upload is bigger than one upload may be
 *   429 more than RATE_MAX uploads in a minute from the same person
 *   507 the inbox is full (its quota)
 *
 * Files stream to a staging folder on disk (never into memory) and the entry
 * is renamed into place once complete; see meta/inbox.js for the layout.
 */
import express from "express";
import multer from "multer";
import path from "path";
import fsp from "fs/promises";

import * as inbox from "../meta/inbox.js";
import * as envs from "../helpers/envs.js";
import { alert } from "../helpers/alerts.js";
import { resolveOrigin } from "../helpers/origin.js";
import { csrfOk, webUser } from "../security/user-session.js";
import debug from "../debug.js";

export const RATE_MAX = 5;
const RATE_WINDOW_MS = 60_000;
const MAX_FILES = 1000;
// Room for the multipart framing and the text fields over the files themselves.
const FORM_OVERHEAD = 256 * 1024;

/** The signed-in web user: name kept in note.json, label for the alert (never an e-mail), slug for the folder. */
function signedIn(req) {
  const who = webUser(req);
  if (!who) return null;
  if (who.kind === "password") return { name: who.name, label: who.name, slug: who.name };
  return { name: who.email, label: "구글 계정 사용자", slug: `google-${String(who.sub).replace(/[^A-Za-z0-9]/g, "").slice(0, 10)}` };
}

const recent = new Map(); // slug → [timestamps]
function overRate(key, now = Date.now()) {
  const times = (recent.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  const over = times.length >= RATE_MAX;
  if (!over) times.push(now);
  recent.set(key, times);
  return over;
}

const fail = (res, status, code, error) => res.status(status).json({ error, code });
const fullMessage = () => "임시 공유함이 가득 찼습니다. 관리자가 정리한 뒤 다시 올립니다";
const tooBigMessage = () => `한 번에 ${inbox.fmtBytes(envs.inboxMaxBytes)}까지 올립니다`;

export default function inboxRouter({ whoOf = signedIn, notify = (text, id) => alert("inbox", text, { subject: id }) } = {}) {
  const router = express.Router();

  router.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    req.inboxUser = whoOf(req);
    if (!req.inboxUser) return fail(res, 401, "signin", "로그인한 사용자만 씁니다");
    next();
  });

  router.get("/", async (_req, res) => {
    const used = envs.inboxEnabled ? await inbox.usage() : 0;
    res.json({ enabled: envs.inboxEnabled, maxBytes: envs.inboxMaxBytes, freeBytes: Math.max(0, envs.inboxQuotaBytes - used) });
  });

  router.post("/", async (req, res) => {
    const origin = req.get("Origin");
    if (origin && origin !== resolveOrigin(req, envs.publicBaseUrl)) return fail(res, 403, "origin", "origin mismatch");
    if (!csrfOk(req)) return fail(res, 403, "csrf", "csrf token missing or wrong");
    if (!envs.inboxEnabled) return fail(res, 404, "off", "임시 공유가 꺼져 있습니다");
    const user = req.inboxUser;
    // Refused before a byte is read: an announced size that can't fit.
    const announced = Number(req.get("content-length")) || 0;
    if (announced > envs.inboxMaxBytes + FORM_OVERHEAD) {
      res.set("Connection", "close");
      return fail(res, 413, "too-big", tooBigMessage());
    }
    if ((await inbox.usage()) + Math.max(0, announced - FORM_OVERHEAD) > envs.inboxQuotaBytes) {
      res.set("Connection", "close");
      return fail(res, 507, "full", fullMessage());
    }
    if (overRate(user.slug)) {
      res.set("Connection", "close");
      return fail(res, 429, "rate", "잠시 뒤에 다시 올립니다");
    }

    const work = await inbox.newStaging();
    let n = 0;
    const upload = multer({
      storage: multer.diskStorage({
        destination: (_req, _file, cb) => cb(null, path.join(work, "in")),
        filename: (_req, _file, cb) => cb(null, `f${n++}`),
      }),
      limits: { fileSize: envs.inboxMaxBytes, files: MAX_FILES, fields: 10, fieldSize: 128 * 1024 },
    }).array("files", MAX_FILES);
    try {
      await new Promise((resolve, reject) => upload(req, res, (err) => (err ? reject(err) : resolve())));
      // multer hands back names as latin1; the browser sent UTF-8.
      const received = req.files ?? [];
      let paths = null;
      try {
        paths = req.body?.paths ? JSON.parse(req.body.paths) : null;
      } catch {
        paths = null;
      }
      const fromFolder = Array.isArray(paths) && paths.length === received.length;
      const files = received.map((f, i) => ({ path: f.path, name: fromFolder ? String(paths[i]) : Buffer.from(f.originalname, "latin1").toString("utf8") }));
      const memo = inbox.cleanMemo(req.body?.memo);
      const links = inbox.parseLinks(req.body?.links);
      if (!files.length && !memo && !links.length) throw new inbox.InboxError(400, "empty", "파일, 메모, 링크 중 하나는 남깁니다");
      const bytes = received.reduce((sum, f) => sum + f.size, 0);
      if (bytes > envs.inboxMaxBytes) throw new inbox.InboxError(413, "too-big", tooBigMessage());
      // Measured again now the files are here: another upload may have filled it meanwhile.
      if ((await inbox.usage()) > envs.inboxQuotaBytes) throw new inbox.InboxError(507, "full", fullMessage());
      const note = await inbox.create({ user: user.name, slug: user.slug, work, files, memo, links });
      debug.log("inbox: %s left %d files (%d bytes), %d links", user.slug, files.length, bytes, links.length);
      notify(inbox.alertText({ ...note, user: user.label }), note.id);
      res.status(201).json({ ok: true, id: note.id, files: note.files.length, bytes });
    } catch (err) {
      await fsp.rm(work, { recursive: true, force: true }).catch(() => {});
      if (err instanceof inbox.InboxError) return fail(res, err.status, err.code, err.message);
      if (err.code === "LIMIT_FILE_SIZE") return fail(res, 413, "too-big", tooBigMessage());
      if (err.code?.startsWith?.("LIMIT_")) return fail(res, 400, "limit", "파일이나 항목이 너무 많습니다");
      debug.error("inbox: upload failed: %s", err.message);
      fail(res, 500, "error", "올리지 못했습니다. 잠시 뒤에 다시 올립니다");
    }
  });

  return router;
}
