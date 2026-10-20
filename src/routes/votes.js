/**
 * 잘 돼요 / 안 돼요 from the people who tried an item (meta/item-votes.js):
 *
 *   GET  /api/votes/:kind/:id                        { up, down, mine }
 *   POST /api/votes/:kind/:id  { vote: "up" | "down" | null }   { up, down, mine } after it
 *
 * kind  homebrew | retro | patch | save, id as its list gives it.
 * mine  this voter's vote ("up" | "down" | null). A voter is a signed-in account
 * or an approved console; anybody else gets 401 (GET too, as there is no `mine`).
 * One vote per voter per item: a new one replaces it, null takes it back.
 *
 * Errors, as { error }: 401 nobody to vote as, 400 a vote that is not up, down
 * or null, 404 unknown kind or item.
 */
import express from "express";
import * as votes from "../meta/item-votes.js";
import { itemOf, FieldError } from "../meta/item-fields.js";
import debug from "../debug.js";

const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);

export default function votesRouter() {
  const router = express.Router();
  router.use(express.json({ limit: "1kb" }));
  router.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    req.voter = votes.voterOf(req);
    if (!req.voter) return res.status(401).json({ error: "sign in to vote" });
    next();
  });

  const item = async (req, res) => {
    const { kind } = req.params;
    if (!votes.KINDS.includes(kind)) return void res.status(404).json({ error: "unknown kind" });
    try {
      return (await itemOf(kind, req.params.id)).id;
    } catch (err) {
      if (err instanceof FieldError) return void res.status(err.status).json({ error: err.message });
      throw err;
    }
  };
  const answer = (res, kind, id, voter) => res.json({ ...votes.tally(kind, id), mine: votes.mine(kind, id, voter) });

  router.get("/:kind/:id", wrap(async (req, res) => {
    const id = await item(req, res);
    if (id) answer(res, req.params.kind, id, req.voter);
  }));

  router.post("/:kind/:id", wrap(async (req, res) => {
    const v = req.body?.vote;
    if (v !== null && !votes.VALUES.includes(v)) return void res.status(400).json({ error: "vote is up, down or null" });
    const id = await item(req, res);
    if (!id) return;
    if (!votes.vote(req.params.kind, id, req.voter, v)) return void res.status(400).json({ error: "cannot vote on this" });
    debug.log("votes: %s:%s %s", req.params.kind, id, v ?? "cleared");
    answer(res, req.params.kind, id, req.voter);
  }));
  return router;
}
