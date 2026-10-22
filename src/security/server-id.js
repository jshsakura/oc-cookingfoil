/**
 * This installation's id: a random UUID made on the first start and kept in
 * the data folder, so every address a server answers on (Cloudflare, direct,
 * LAN) gives the same one and a client can tell two addresses of one server
 * from two servers. Random, not derived from any secret, so it is safe to show.
 * A copied data folder carries it along; deleting the file makes a new one.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "../helpers/envs.js";
import debug from "../debug.js";

const FILE = path.join(dataDir, "server-id");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let cached = null;

/** The UUID in `file`, made there first when it is missing or malformed. */
export function readOrCreate(file = FILE) {
  try {
    const kept = fs.readFileSync(file, "utf8").trim();
    if (UUID_RE.test(kept)) return kept;
    if (kept) debug.error("server-id: %s is malformed, making a new one", file);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  const id = crypto.randomUUID();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, `${id}\n`);
  fs.renameSync(`${file}.tmp`, file);
  return id;
}

/** This server's id, read once. */
export const serverId = () => (cached ??= readOrCreate());

export const SERVER_ID_HEADER = "X-CookingFoil-Server-Id";

/** Puts the server id on every response, set early so refusals carry it too. */
export function serverIdHeader() {
  return (_req, res, next) => {
    res.set(SERVER_ID_HEADER, serverId());
    next();
  };
}
