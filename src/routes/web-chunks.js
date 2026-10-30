/**
 * Resumable uploads for the public site's own routes (picture editor, share inbox, upload tray), the same
 * mechanism as the admin page's (meta/upload-chunks.js). Mounted inside the route's router, so each surface
 * keeps the sign-in and origin checks it is mounted behind; `account` and `guardWrites` add the ones the
 * surface makes in its own handlers (the inbox's sign-in, origin and CSRF token).
 *
 *   POST   <router>/chunks        { name, size, lastModified } → { id, offset, size }   start, or pick up where it stopped
 *   PUT    <router>/chunks/:id?offset=N   raw bytes (≤ 32 MiB) → { offset }           409 + the real offset when N is wrong
 *
 * No status or cancel route: the page learns the offset from the 409, and a forgotten partial is swept after a day.
 * Every partial records its account, so an id another account started is unknown here: 404.
 */
import express from "express";
import * as chunks from "../meta/upload-chunks.js";
import { apiWord } from "./admin/api-words.js";
import debug from "../debug.js";

/** A refusal in the surface's own words: its status, a stable `code` and a message. */
export class WebRefusal extends Error {
  constructor(status, code, message = code) {
    super(message);
    Object.assign(this, { status, code });
  }
}

const SWEEP_EVERY_MS = 3600_000;

/** The JSON a ChunkError answers with, in the request's language. */
export const chunkErrorBody = (req, err) => ({ error: apiWord(req, err.key, err.vars), code: err.key, ...err.extra });

/**
 * @param {import("express").Router} router
 * @param {object} o
 * @param {string} o.purpose        names the folder and the kind: inbox, uploads, art
 * @param {(req) => string | null} o.account  who owns the upload; null when nobody is signed in
 * @param {(req, res) => void} [o.signedOut]  answers a request with no account
 * @param {(req, res) => boolean} [o.guardWrites]  false once it has answered a refused write
 * @param {(req, decl: {id, name, size}) => Promise<void>} [o.check]  the surface's limits at the start; throws to refuse
 * @param {(req, res, err) => boolean} [o.answer]  says a refusal in the surface's own words; true once sent
 */
export function mountWebChunks(router, { purpose, account, signedOut = (_req, res) => res.status(401).json({ error: "sign in first", code: "signin" }), guardWrites = () => true, check = null, answer = () => false }) {
  const dir = chunks.webChunksDir(purpose);
  const sweep = () => chunks.sweep(dir).catch(() => {});
  sweep();
  setInterval(sweep, SWEEP_EVERY_MS).unref();

  const route = (handler) => async (req, res) => {
    res.set("Cache-Control", "no-store");
    const who = account(req);
    if (!who) return void signedOut(req, res);
    if (!guardWrites(req, res)) return;
    try {
      await handler(req, res, who);
    } catch (err) {
      if (answer(req, res, err)) return;
      if (err instanceof WebRefusal) return void res.status(err.status).json({ error: err.message, code: err.code });
      if (err instanceof chunks.ChunkError) return void res.status(err.status).json(chunkErrorBody(req, err));
      debug.error("%s chunk: %s", purpose, err.message);
      res.status(500).json({ error: "upload failed", code: "error" });
    }
  };

  router.post("/chunks", express.json({ limit: "16kb" }), route(async (req, res, who) => {
    const { name, size, lastModified } = req.body ?? {};
    res.json(await chunks.begin(dir, { account: who, kind: purpose, name, size, lastModified }, check ? (decl) => check(req, decl) : null));
  }));
  router.put("/chunks/:id", route(async (req, res, who) => {
    const offset = Number(req.query.offset);
    if (!Number.isSafeInteger(offset) || offset < 0) throw new chunks.ChunkError(400, "upload.badOffset");
    res.json({ offset: await chunks.append(dir, req.params.id, who, offset, await chunks.rawBody(req, chunks.MAX_CHUNK_BYTES)) });
  }));
}
