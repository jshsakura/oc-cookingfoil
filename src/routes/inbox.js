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
 *                     → 201 { ok, id, files, bytes, items: [{ name, size }] }
 *
 * The admin chat's attach button posts the same form to /admin/api/chat/attach (inboxUpload,
 * mounted by routes/admin/chat-api.js) under the admin session, with no alert to the admin.
 *
 *   400 { code: empty | bad-link | too-many-links | memo-too-long }  nothing given, or a field that doesn't fit
 *   401 not signed in on the web (a console's keys don't count)
 *   403 another site's origin, or the CSRF token is missing or wrong
 *   404 the inbox is switched off (settings tab)
 *   413 the upload is bigger than one upload may be
 *   429 more than RATE_MAX uploads in a minute from the same person
 *   507 the inbox is full (its quota)
 *
 * Files stream to a staging folder on disk (never into memory) and the entry
 * is renamed into place once complete; see meta/inbox.js for the layout.
 * The bytes are counted as they arrive, across all files of the request, and
 * held against the quota together with every other upload in flight: the
 * moment one passes either limit it is answered and its connection closed,
 * so an upload that never said its size can't fill the disk first.
 */
import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import fsp from "fs/promises";

import * as inbox from "../meta/inbox.js";
import * as envs from "../helpers/envs.js";
import { alert } from "../helpers/alerts.js";
import { resolveOrigin } from "../helpers/origin.js";
import { csrfOk, webUser } from "../security/user-session.js";
import { createKeyRate } from "../security/key-rate.js";
import debug from "../debug.js";
import { isMetaCode, metaText } from "../meta/meta-messages.js";
import { requestLang } from "../meta/langs.js";

export const RATE_MAX = 5;
const RATE_WINDOW_MS = 60_000;
const MAX_FILES = 500;
// Room for the multipart framing and the text fields over the files themselves.
const FORM_OVERHEAD = 256 * 1024;

/** The signed-in web user: name kept in note.json, label for the alert (never an e-mail), slug for the folder. */
function signedIn(req) {
  const who = webUser(req);
  if (!who) return null;
  if (who.kind === "password") return { name: who.name, label: who.name, slug: who.name };
  return { name: who.email, label: "구글 계정 사용자", slug: `google-${String(who.sub).replace(/[^A-Za-z0-9]/g, "").slice(0, 10)}` };
}

const uploadRate = createKeyRate({ max: RATE_MAX, windowMs: RATE_WINDOW_MS });

/** Answers `code` (what the page branches on) with message `key` in the request's language; origin and csrf say plain English. */
const fail = (req, res, status, code, key, vars) => res.status(status).json({ error: isMetaCode(key) ? metaText(requestLang(req), key, vars) : key, code });

let inFlight = 0; // bytes of uploads being received, held against the quota

/**
 * The bytes one request may still take: at most maxBytes for the whole
 * request, and no more than the quota leaves after the inbox and the other
 * uploads in flight. take() returns an InboxError once a chunk won't fit.
 */
function budget(used) {
  let mine = 0;
  let over = null; // once over, every later chunk is refused too
  return {
    take(n) {
      if (over) return over;
      if (mine + n > envs.inboxMaxBytes) over = new inbox.InboxError(413, "too-big", "inbox.tooBig", tooBigVars());
      else if (used + inFlight + n > envs.inboxQuotaBytes) over = new inbox.InboxError(507, "full", "inbox.full");
      if (over) return over;
      mine += n;
      inFlight += n;
      return null;
    },
    // Safe to call more than once: what is released is no longer held.
    release() {
      inFlight -= mine;
      mine = 0;
    },
  };
}

/** Multer storage that writes each file to `work/in` and charges every chunk to the request's budget. */
function countedStorage(work, money, onOver) {
  let n = 0;
  return {
    _handleFile(_req, file, cb) {
      const dest = path.join(work, "in", `f${n++}`);
      const out = fs.createWriteStream(dest);
      let size = 0;
      let stopped = false;
      const stop = (err) => {
        if (stopped) return;
        stopped = true;
        file.stream.unpipe(out);
        file.stream.resume();
        out.destroy();
        fs.rm(dest, { force: true }, () => cb(err));
      };
      file.stream.on("data", (chunk) => {
        if (stopped) return;
        const err = money.take(chunk.length);
        if (err) {
          onOver(err);
          stop(err);
        } else size += chunk.length;
      });
      out.on("error", stop);
      // the connection was closed under it (cut off, or the browser went away)
      file.stream.on("error", stop);
      out.on("finish", () => { if (!stopped) cb(null, { path: dest, size }); });
      file.stream.pipe(out);
    },
    _removeFile(_req, file, cb) {
      fs.rm(file.path, { force: true }, cb);
    },
  };
}
const tooBigVars = () => ({ size: inbox.fmtBytes(envs.inboxMaxBytes) });

const tellAdmin = (text, id) => alert("inbox", text, { subject: id });

/**
 * The upload itself, as one handler: `whoOf(req)` names the uploader ({ name, label, slug }) or
 * null, `csrf(req)` checks the request's token, `notify(text, id)` tells the admin.
 */
export function inboxUpload({ whoOf = signedIn, notify = tellAdmin, csrf = csrfOk } = {}) {
  return async (req, res) => {
    res.set("Cache-Control", "no-store");
    const user = whoOf(req);
    if (!user) return fail(req, res, 401, "signin", "inbox.signin");
    const origin = req.get("Origin");
    if (origin && origin !== resolveOrigin(req, envs.publicBaseUrl)) return fail(req, res, 403, "origin", "origin mismatch");
    if (!csrf(req)) return fail(req, res, 403, "csrf", "csrf token missing or wrong");
    if (!envs.inboxEnabled) return fail(req, res, 404, "off", "inbox.off");
    // Refused before a byte is read: an announced size that can't fit.
    const announced = Number(req.get("content-length")) || 0;
    if (announced > envs.inboxMaxBytes + FORM_OVERHEAD) {
      res.set("Connection", "close");
      return fail(req, res, 413, "too-big", "inbox.tooBig", tooBigVars());
    }
    if ((await inbox.usage()) + Math.max(0, announced - FORM_OVERHEAD) > envs.inboxQuotaBytes) {
      res.set("Connection", "close");
      return fail(req, res, 507, "full", "inbox.full");
    }
    if (!uploadRate.hit(user.slug).ok) {
      res.set("Connection", "close");
      return fail(req, res, 429, "rate", "inbox.rate");
    }

    const work = await inbox.newStaging();
    const money = budget(await inbox.usage());
    // Over a limit mid-stream: drop what came in, answer now and close the connection instead of reading on.
    let cut = false;
    const cutOff = async (err) => {
      if (cut) return;
      cut = true;
      money.release();
      await fsp.rm(work, { recursive: true, force: true }).catch(() => {});
      if (res.headersSent) return;
      res.set("Connection", "close");
      res.on("finish", () => req.socket?.destroy());
      fail(req, res, err.status, err.code, err.key, err.vars);
    };
    // However the request ends, what it held against the quota is let go.
    res.on("close", () => money.release());
    const upload = multer({
      storage: countedStorage(work, money, cutOff),
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
      if (!files.length && !memo && !links.length) throw new inbox.InboxError(400, "empty", "inbox.empty");
      const bytes = received.reduce((sum, f) => sum + f.size, 0);
      const note = await inbox.create({ user: user.name, slug: user.slug, work, files, memo, links });
      debug.log("inbox: %s left %d files (%d bytes), %d links", user.slug, files.length, bytes, links.length);
      notify(inbox.alertText({ ...note, user: user.label }), note.id);
      res.status(201).json({ ok: true, id: note.id, files: note.files.length, bytes, items: note.files.map(({ name, size }) => ({ name, size })) });
    } catch (err) {
      await fsp.rm(work, { recursive: true, force: true }).catch(() => {});
      if (res.headersSent) return;
      if (err instanceof inbox.InboxError) return fail(req, res, err.status, err.code, err.key, err.vars);
      if (err.code === "LIMIT_FILE_SIZE") return fail(req, res, 413, "too-big", "inbox.tooBig", tooBigVars());
      if (err.code?.startsWith?.("LIMIT_")) return fail(req, res, 400, "limit", "inbox.limit");
      debug.error("inbox: upload failed: %s", err.message);
      fail(req, res, 500, "error", "inbox.error");
    } finally {
      money.release();
    }
  };
}

export default function inboxRouter({ whoOf = signedIn, notify = tellAdmin } = {}) {
  const router = express.Router();
  // A server stopped mid-upload left its staging folder behind.
  inbox.clearStaging();

  router.get("/", async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (!whoOf(req)) return fail(req, res, 401, "signin", "inbox.signin");
    const used = envs.inboxEnabled ? await inbox.usage() : 0;
    res.json({ enabled: envs.inboxEnabled, maxBytes: envs.inboxMaxBytes, freeBytes: Math.max(0, envs.inboxQuotaBytes - used) });
  });
  router.post("/", inboxUpload({ whoOf, notify }));
  return router;
}
