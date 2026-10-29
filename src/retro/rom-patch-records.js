/**
 * Which retro ROMs carry a patch the admin applied (rom-patch.js), a row per game in the
 * security database (records kind "retro-rom-patch", id the game id):
 *
 *   { system, path, file, backup, original: { size }, patches: [P…] }
 *   P = { name, format, verified, at }
 *
 * path is the ROM's and backup the original's, both relative to the retro folder; size is the
 * original's. verified is false for IPS, which carries no checksum. The row goes when the original is
 * restored. game-view.js reads it to mark the game as patched in every list.
 */
import { recordStore } from "../db/security-stores.js";
import * as indexRevision from "./index-revision.js";

let rows = null;
let patched = null; // Map game id → record

const table = () => (rows ??= recordStore("retro-rom-patch"));
const all = () => (patched ??= new Map(table().load()));

/** The patch record of a game, or null. */
export const patchOf = (id) => all().get(id) ?? null;

/** Every patch record as [id, record]. */
export const patchedGames = () => [...all()];

/** Saves (or, with null, drops) a game's patch record. */
export function setPatch(id, record) {
  const next = new Map(all());
  if (record) next.set(id, record);
  else next.delete(id);
  try {
    table().sync(next);
  } catch (err) {
    table().forget();
    throw err;
  }
  patched = next;
  indexRevision.bump();
}
