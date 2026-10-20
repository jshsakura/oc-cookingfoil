/**
 * What people who tried an item say about it: 잘 돼요 (up) or 안 돼요 (down),
 * one vote per voter per item, a new vote replacing the old one. Kept in
 * ${COOK_DATA_DIR}/item-votes.json as
 * { "<kind>:<id>": { "<voter>": { v: "up" | "down", at: <ms> } } }.
 * A voter is "acct:<name>", "google:<sub>" or "dev:<hash of the device key>"
 * (voterOf). Callers check that the item exists; removing one forgets its votes.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { dataDir } from "../helpers/envs.js";

const FILE = path.join(dataDir, "item-votes.json");
export const KINDS = ["homebrew", "retro", "patch", "save"];
export const VALUES = ["up", "down"];
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const VOTER_RE = /^(acct|google|dev):.{1,128}$/;

let saved = null;

function all() {
  if (saved) return saved;
  try {
    saved = JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
    saved = {};
  }
  return saved;
}

function write(next) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(`${FILE}.tmp`, `${JSON.stringify(next)}\n`);
  fs.renameSync(`${FILE}.tmp`, FILE);
  saved = next;
}

const keyOf = (kind, id) => `${kind}:${id}`;
const known = (kind, id) => KINDS.includes(kind) && ID_RE.test(String(id));

/**
 * Who a request votes as, or null for nobody: the account signed in on the web,
 * else the console (its key hashed, so the file holds no device keys), else the
 * account a console's session was made for.
 */
export function voterOf(req) {
  if (req.webUser?.kind === "google") return `google:${req.webUser.sub}`;
  if (req.webUser?.kind === "password") return `acct:${req.webUser.name}`;
  const dev = req.pairedDevice ?? req.sessionDevice;
  if (dev) return `dev:${crypto.createHash("sha256").update(String(dev)).digest("hex").slice(0, 32)}`;
  return req.auth?.user && !req.apiToken ? `acct:${req.auth.user}` : null;
}

/** { up, down } for an item. */
export function tally(kind, id) {
  const out = { up: 0, down: 0 };
  for (const { v } of Object.values(all()[keyOf(kind, id)] ?? {})) if (v === "up" || v === "down") out[v] += 1;
  return out;
}

/** The voter's vote on the item: "up", "down" or null. */
export const mine = (kind, id, voter) => (voter ? all()[keyOf(kind, id)]?.[voter]?.v ?? null : null);

/** { votes: { up, down }, my_vote } for a public listing. */
export const fields = (kind, id, voter) => ({ votes: tally(kind, id), my_vote: mine(kind, id, voter) });

/** Sets (or with v null clears) a voter's vote. False for an unknown kind, malformed id or voter, or bad value. */
export function vote(kind, id, voter, v, now = Date.now()) {
  if (!known(kind, id) || !VOTER_RE.test(String(voter)) || (v !== null && !VALUES.includes(v))) return false;
  const key = keyOf(kind, id);
  const { [voter]: _had, ...others } = all()[key] ?? {};
  const votes = v === null ? others : { ...others, [voter]: { v, at: now } };
  const { [key]: _old, ...rest } = all();
  write(Object.keys(votes).length ? { ...rest, [key]: votes } : rest);
  return true;
}

/** Drops every vote on the item (it was removed, or the admin cleared it). */
export function forget(kind, id) {
  if (!Object.hasOwn(all(), keyOf(kind, id))) return;
  const { [keyOf(kind, id)]: _gone, ...rest } = all();
  write(rest);
}

/** For tests. */
export function reset() {
  saved = null;
}
