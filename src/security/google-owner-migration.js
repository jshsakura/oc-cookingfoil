/**
 * Records made before Google accounts were filed by sub named their owner "google:<email>". An email
 * can change while the sub stays, and that cut an account off from its own consoles, downloads,
 * wishlist, sends and chats (google-accounts.js ownerOf). This rewrites every such owner it can match
 * to an account into "google:<sub>". It runs at every start before the stores read their records, and
 * a second run finds nothing left to change. An email no account has any more stays as it is.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import debug from "../debug.js";

const GOOGLE = "google:";

/** The record kinds that file a Google owner: in a field of the record, or as the record's id. */
const IN_FIELD = { device: ["addedBy"], "enroll-token": ["owner"], "pending-device": ["download", "owner"], "device-send": ["sentBy"] };
const AS_ID = ["enroll-ledger", "wishlist", "send-history"];

const chatFolder = (account) => crypto.createHash("sha256").update(String(account)).digest("base64url");

function subsByEmail(db) {
  const map = new Map();
  for (const { data } of db.prepare("SELECT data FROM records WHERE kind = 'google-account'").all()) {
    try {
      const a = JSON.parse(data);
      if (a?.sub && a?.email) map.set(String(a.email).toLowerCase(), { sub: String(a.sub), email: String(a.email) });
    } catch {
      /* a broken row names nobody */
    }
  }
  return map;
}

/** "google:<sub>" for an email-form owner a known account has, else null. */
const rewrite = (owner, subs) => {
  if (typeof owner !== "string" || !owner.startsWith(GOOGLE)) return null;
  const a = subs.get(owner.slice(GOOGLE.length).toLowerCase());
  return a ? GOOGLE + a.sub : null;
};

/** @returns {number} how many records and chat folders it changed */
export function migrateGoogleOwners(db, { chatDir = null } = {}) {
  const subs = subsByEmail(db);
  if (!subs.size) return 0;
  let changed = 0;
  const update = db.prepare("UPDATE records SET data = ? WHERE kind = ? AND id = ?");
  const move = db.prepare("UPDATE records SET id = ? WHERE kind = ? AND id = ?");
  const has = db.prepare("SELECT 1 FROM records WHERE kind = ? AND id = ?");
  db.exec("BEGIN");
  try {
    for (const [kind, field] of Object.entries(IN_FIELD)) {
      for (const { id, data } of db.prepare("SELECT id, data FROM records WHERE kind = ?").all(kind)) {
        let rec;
        try { rec = JSON.parse(data); } catch { continue; }
        const holder = field.slice(0, -1).reduce((o, k) => (o && typeof o === "object" ? o[k] : null), rec);
        const key = field.at(-1);
        const next = holder && typeof holder === "object" ? rewrite(holder[key], subs) : null;
        if (!next) continue;
        holder[key] = next;
        update.run(JSON.stringify(rec), kind, id);
        changed++;
      }
    }
    for (const kind of AS_ID) {
      for (const { id } of db.prepare("SELECT id FROM records WHERE kind = ?").all(kind)) {
        const next = rewrite(id, subs);
        // The account already has records under its sub (it used both before this ran): those stay.
        if (!next || has.get(kind, next)) continue;
        move.run(next, kind, id);
        changed++;
      }
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  if (chatDir && fs.existsSync(chatDir)) {
    for (const { email, sub } of subs.values()) {
      const from = path.join(chatDir, chatFolder(`user:${GOOGLE}${email}`));
      const to = path.join(chatDir, chatFolder(`user:${GOOGLE}${sub}`));
      if (fs.existsSync(from) && !fs.existsSync(to)) {
        fs.renameSync(from, to);
        changed++;
      }
    }
  }
  if (changed) debug.log("security: filed %d Google owner record(s) by account id instead of email", changed);
  return changed;
}
