/**
 * "찜": games a signed-in account wants, by title id (security/wishlist.js).
 *
 * The web page (a library account or the admin session, same origin, signed in):
 *   GET  /pair/api/wishlist                      → { items: [{ titleId, name, addedAt }] }, newest first
 *   POST /pair/api/wishlist { titleId, name }    → { ok: true, wish, existing }
 *        400 bad title id · 409 the list is full (500)
 *   POST /pair/api/wishlist/remove { titleId }   → { ok: true, removed }
 *
 * The console (device key + access key, or its session token):
 *   GET  /api/device/wishlist
 *        → 200 { serverId, items: [{ titleId, name, addedAt, inLibrary }] }
 *        The list of the account that approved this console (the admin's for a console the
 *        admin approved; none for one approved automatically or from Telegram). `inLibrary`
 *        says whether this server holds the base game. A console registered with several
 *        servers merges the lists by titleId and tells servers apart by serverId. The body
 *        is an ETag: send If-None-Match to get 304 while nothing changed.
 */
import crypto from "node:crypto";
import express from "express";

import * as store from "../security/store.js";
import * as users from "../security/users.js";
import * as wishlist from "../security/wishlist.js";
import { serverId } from "../security/server-id.js";
import { relPathsForBase } from "../meta/library-cache.js";

const inLibrary = (titleId) => relPathsForBase(titleId).length > 0 || relPathsForBase(titleId.toLowerCase()).length > 0;

/** The account whose wishes a console shows: the one that approved it, or null for a system approval. */
export function ownerOf(deviceKey) {
  const row = store.devicesSnapshot().approved.find((d) => d.deviceKey === deviceKey);
  if (!row?.addedBy) return null;
  return users.SYSTEM_APPROVERS.has(row.addedBy) && row.addedBy !== "admin" ? null : row.addedBy;
}

/** The console endpoint, mounted at /api/device/wishlist behind the sign-in gates. */
export function consoleWishlistRouter() {
  const router = express.Router();
  router.get("/", (req, res) => {
    res.set("Cache-Control", "private, no-cache");
    const deviceKey = req.pairedDevice ?? req.sessionDevice ?? null;
    if (!deviceKey) return res.status(403).json({ error: "a paired console only" });
    const owner = ownerOf(deviceKey);
    const items = (owner ? wishlist.list(owner) : []).map((w) => ({ ...w, inLibrary: inLibrary(w.titleId) }));
    const etag = `"${crypto.createHash("sha1").update(JSON.stringify(items)).digest("base64url")}"`;
    res.set("ETag", etag);
    if (req.get("If-None-Match") === etag) return res.status(304).end();
    res.json({ serverId: serverId(), items });
  });
  return router;
}

/** The web endpoints, mounted into the /pair router (which owns the same-origin and sign-in rules). */
export function mountWebWishlist(router, { guardWrite, approverOf }) {
  const json = express.json({ limit: "4kb" });

  router.get("/api/wishlist", (req, res) => {
    res.set("Cache-Control", "no-store");
    const account = approverOf(req);
    if (!account) return res.status(401).json({ error: "sign in first" });
    res.json({ items: wishlist.list(account) });
  });

  router.post("/api/wishlist", json, (req, res) => {
    const account = guardWrite(req, res);
    if (!account) return;
    const titleId = wishlist.cleanTitleId(req.body?.titleId);
    if (!titleId) return res.status(400).json({ error: "titleId is 16 hex digits" });
    const out = wishlist.add(account, titleId, req.body?.name);
    if (out.refused) return res.status(409).json({ error: "the wishlist is full" });
    res.json({ ok: true, ...out });
  });

  router.post("/api/wishlist/remove", json, (req, res) => {
    const account = guardWrite(req, res);
    if (!account) return;
    const titleId = wishlist.cleanTitleId(req.body?.titleId);
    if (!titleId) return res.status(400).json({ error: "titleId is 16 hex digits" });
    res.json({ ok: true, removed: wishlist.remove(account, titleId) });
  });
}
