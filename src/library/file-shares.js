/**
 * Download links for one file that anyone holding the link can use until it runs out, made from the admin file
 * browser. The link carries a random token; only its SHA-256 is kept (the security database's records), so a copy
 * of the database opens no link. A link names its file by storage key and path, and every use goes through
 * file-roots again, so a file moved, renamed or fenced since is simply not found.
 */
import crypto from "crypto";
import { recordStore } from "../db/security-stores.js";
import { FileError } from "./file-roots.js";

export const SHARE_HOURS = Object.freeze([1, 24, 168]);
const SHARES_MAX = 200;
const HOUR_MS = 60 * 60 * 1000;

const idOf = (token) => crypto.createHash("sha256").update(String(token)).digest("hex");

let shared = null;
/** The one set of links the admin API and the public route both use. */
export const fileShares = () => (shared ??= createFileShares());

export function createFileShares({ store = recordStore("file-share"), now = Date.now } = {}) {
  let shares = null;
  const all = () => (shares ??= new Map(store.load()));
  const write = (next) => {
    store.sync(next);
    shares = next;
  };
  const live = () => {
    const t = now();
    const kept = new Map([...all()].filter(([, s]) => s.expiresAt > t));
    if (kept.size !== all().size) write(kept);
    return kept;
  };

  return {
    /** { token, id, expiresAt } for a new link to `rel` in storage `root`; the token is shown once and never kept. */
    create({ root, rel, name, hours, by = null }) {
      if (!SHARE_HOURS.includes(hours)) throw new FileError("share-hours");
      const kept = live();
      if (kept.size >= SHARES_MAX) throw new FileError("share-full", 429);
      const token = crypto.randomBytes(24).toString("base64url");
      const id = idOf(token);
      const share = { root, rel, name, by, createdAt: now(), expiresAt: now() + hours * HOUR_MS };
      write(new Map([...kept, [id, share]]));
      return { token, id, expiresAt: share.expiresAt };
    },
    /** The live share a link's token opens, or null. */
    find: (token) => live().get(idOf(token)) ?? null,
    /** The live links to one file, newest first, as { id, expiresAt, by }. */
    of: (root, rel) =>
      [...live()]
        .filter(([, s]) => s.root === root && s.rel === rel)
        .map(([id, s]) => ({ id, expiresAt: s.expiresAt, by: s.by }))
        .sort((a, b) => b.expiresAt - a.expiresAt),
    /** Ends a link at once; false when there was none. */
    revoke(id) {
      const kept = live();
      if (!kept.delete(String(id))) return false;
      write(kept);
      return true;
    },
  };
}
