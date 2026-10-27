/**
 * "Send to my console": a signed-in user queues a download for one of their own
 * consoles on the web page, and the console picks it up.
 *
 * The web page (a library account or the admin session, same origin, signed in):
 *   POST /pair/api/sends { deviceKey, path }   queue a game file for a console the caller approved
 *        → { ok: true, item, existing }        existing: the path was already waiting, nothing added
 *        400 bad body or path · 404 not in the library / not the caller's console · 409 queue full (50)
 *   GET  /pair/api/sends                       the caller's waiting items → { consoles: [{ deviceKey, items }] }
 *   POST /pair/api/sends/<id>/cancel           withdraw one the caller sent → { ok: true } or 404
 *   `path` is the file's library-relative path (the item's url without its "../" and unescaped).
 *   The admin session may send to any console; a library account only to those it approved.
 *
 * The console (device key + access key, or its session token; it reads and acks only its own queue):
 *   GET  /api/device/sends
 *        → 200 { serverId, items: [{ id, path, name, titleId, size, sentAt, sentBy, url }] }
 *        Answers at once (no waiting), sorted by sentAt ascending. `url` is absolute and downloads the
 *        file with the console's usual credentials (on the direct address when the client asked for
 *        it, as in /api/library/sections). The list is an ETag of the queue: send If-None-Match to get
 *        304 while nothing changed. It reads memory only, so it is cheap to repeat (every ~30 s).
 *   POST /api/device/sends/ack { ids: [id, ...], result: "accepted" | "declined" }
 *        → { ok: true, removed: <n> }  The items are removed, whatever the result; ids that are not
 *        this console's are ignored. "accepted": the console took them into its download queue.
 *
 * A console registered with several servers merges the lists by `sentAt` (an ISO time the server
 * stamped, so the order is the order the people pressed the button, whichever server held it) and
 * tells servers apart by `serverId` (the id of data/server-id, the same on every address of one server).
 * Items lapse after 7 days. Revoking a console drops its queue.
 */
import crypto from "node:crypto";
import express from "express";

import * as store from "../security/store.js";
import * as sends from "../security/device-sends.js";
import * as downloadLinks from "../security/download-links.js";
import { normalizeDeviceKey } from "../security/pairing.js";
import { serverId } from "../security/server-id.js";
import { fileByRel } from "../meta/library-cache.js";
import { encodeRelPath } from "../create-index-content.js";
import { resolveOrigin } from "../helpers/origin.js";
import { publicBaseUrl } from "../helpers/envs.js";
import debug from "../debug.js";

const ID_RE = /^[0-9a-f]{12}$/;
const MAX_PATH = 1024;

/** `value` as a clean library-relative path, or null: no leading slash, no "." or ".." segment, no backslash or NUL. Pure. */
export function cleanRelPath(value) {
  if (typeof value !== "string" || !value || value.length > MAX_PATH) return null;
  const rel = value.startsWith("../") ? value.slice(3) : value;
  if (rel.startsWith("/") || /[\\\0]/.test(rel)) return null;
  return rel.split("/").some((s) => s === "" || s === "." || s === "..") ? null : rel;
}

/** Queues the library file at `rawPath` for a console; { item, existing }. Throws an Error with .status 400 (bad path), 404 (not in the library) or 409 (queue full). */
export function queueFile(deviceKey, rawPath, sentBy) {
  const fail = (status, message) => Object.assign(new Error(message), { status });
  const rel = cleanRelPath(rawPath);
  if (!rel) throw fail(400, "bad path");
  const file = fileByRel(rel);
  if (!file) throw fail(404, "not in the library");
  const out = sends.add(deviceKey, { path: rel, name: file.name, titleId: file.titleId, size: file.size }, sentBy);
  if (out.refused) throw fail(409, "that console already has the most it can hold");
  return { item: out.item, existing: out.existing };
}

/** The queue as the console reads it, with each item's download address. */
function consoleItems(req) {
  const origin = resolveOrigin(req, publicBaseUrl);
  const link = downloadLinks.forRequest(req);
  return sends.list(req.pairedDevice ?? req.sessionDevice).map((item) => {
    const rest = encodeRelPath(item.path).slice(3);
    return { ...item, url: link ? `${link.base}/${rest}` : origin ? `${origin}/${rest}` : `../${rest}` };
  });
}

/** The console endpoints, mounted at /api/device/sends behind the sign-in gates. */
export function consoleSendsRouter() {
  const router = express.Router();
  const json = express.json({ limit: "8kb" });
  const deviceOf = (req) => req.pairedDevice ?? req.sessionDevice ?? null;

  router.get("/", (req, res) => {
    res.set("Cache-Control", "private, no-cache");
    if (!deviceOf(req)) return res.status(403).json({ error: "a paired console only" });
    sends.markRead(deviceOf(req));
    const items = consoleItems(req);
    const etag = `"${crypto.createHash("sha1").update(items.map((i) => i.id).join(",")).digest("base64url")}"`;
    res.set("ETag", etag);
    if (req.get("If-None-Match") === etag) return res.status(304).end();
    res.json({ serverId: serverId(), items });
  });

  router.post("/ack", json, (req, res) => {
    const deviceKey = deviceOf(req);
    if (!deviceKey) return res.status(403).json({ error: "a paired console only" });
    const { ids, result } = req.body ?? {};
    if (!Array.isArray(ids) || ids.length > sends.MAX_PENDING || !ids.every((i) => typeof i === "string" && ID_RE.test(i))) {
      return res.status(400).json({ error: "ids required" });
    }
    if (result !== "accepted" && result !== "declined") return res.status(400).json({ error: "result must be accepted or declined" });
    const removed = sends.remove(deviceKey, ids);
    debug.log("sends: console %s %s %d", deviceKey.slice(0, 8), result, removed);
    res.set("Cache-Control", "no-store").json({ ok: true, removed });
  });

  return router;
}

/** The web endpoints, mounted into the /pair router (which owns the same-origin and sign-in rules). */
export function mountWebSends(router, { guardWrite, approverOf, ownsApproval }) {
  const json = express.json({ limit: "4kb" });

  const ownDevice = (req, approver, deviceKey) =>
    Boolean(deviceKey) && store.devicesSnapshot().approved.some((d) => d.deviceKey === deviceKey && (approver === "admin" && !req.auth?.user ? true : ownsApproval(req, approver, d.addedBy)));

  router.post("/api/sends", json, (req, res) => {
    const approver = guardWrite(req, res);
    if (!approver) return;
    const deviceKey = normalizeDeviceKey(req.body?.deviceKey);
    if (!deviceKey || !ownDevice(req, approver, deviceKey)) return res.status(404).json({ error: "no such device" });
    try {
      const out = queueFile(deviceKey, req.body?.path, approver);
      debug.log("sends: %s queued a file for a console", approver);
      res.json({ ok: true, ...out });
    } catch (err) {
      res.status(err.status ?? 500).json({ error: err.message });
    }
  });

  router.get("/api/sends", (req, res) => {
    res.set("Cache-Control", "no-store");
    const approver = approverOf(req);
    if (!approver) return res.status(401).json({ error: "sign in first" });
    res.json({ consoles: sends.listBy(approver) });
  });

  router.post("/api/sends/:id/cancel", (req, res) => {
    const approver = guardWrite(req, res);
    if (!approver) return;
    const found = ID_RE.test(req.params.id) ? sends.find(req.params.id, { sentBy: approver }) : null;
    if (!found) return res.status(404).json({ error: "no such request waiting" });
    sends.remove(found.deviceKey, [found.item.id], { sentBy: approver });
    res.json({ ok: true });
  });
}
