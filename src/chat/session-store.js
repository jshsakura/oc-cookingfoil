/**
 * Chat conversations, one append-only JSONL file each under `<dir>/<account>/<id>.jsonl`.
 *
 * The account folder is a hash of the account id, so whatever the sign-in system calls an account
 * (a user ID, a Google sub) cannot name a path. A conversation is found only through its owner's
 * folder: another account asking for the same id gets nothing, the same answer as an id that does
 * not exist. A crash can leave a half-written last line; reading skips it and the next append
 * starts a new line.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const CONVERSATION_ID_RE = /^[A-Za-z0-9_-]{22}$/;
const ROLES = new Set(["user", "assistant", "tool", "system"]);
const TITLE_MAX = 80;

const fail = (message) => new Error(message);
const accountFolder = (account) => crypto.createHash("sha256").update(String(account)).digest("base64url");

/** The parsed lines of a conversation file; a line that does not parse is dropped. */
function parse(text) {
  const rows = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      // A torn write: nothing after it is trusted to belong to the same record.
    }
  }
  return rows;
}

function checkedEntry(entry) {
  const ok = entry && typeof entry === "object" && !Array.isArray(entry) && ROLES.has(entry.role) && typeof entry.content === "string";
  if (!ok) throw fail("entry must be { role: user|assistant|tool|system, content: string }");
  return entry;
}

export function createChatStore({ dir }) {
  const folder = (account) => path.join(dir, accountFolder(account));
  const fileOf = (account, id) => (typeof id === "string" && CONVERSATION_ID_RE.test(id) ? path.join(folder(account), `${id}.jsonl`) : null);
  const readRows = (file) => {
    try {
      return parse(fs.readFileSync(file, "utf8"));
    } catch {
      return null;
    }
  };

  return {
    /** A new, empty conversation owned by `account`; returns its id. */
    create(account, { now = Date.now() } = {}) {
      const id = crypto.randomBytes(16).toString("base64url");
      fs.mkdirSync(folder(account), { recursive: true, mode: 0o700 });
      fs.writeFileSync(fileOf(account, id), `${JSON.stringify({ meta: { created: now } })}\n`, { mode: 0o600, flag: "wx" });
      return id;
    },

    /** Adds one message. Throws when `account` has no conversation `id`. */
    append(account, id, entry, { now = Date.now() } = {}) {
      const file = fileOf(account, id);
      if (!file || !fs.existsSync(file)) throw fail("no such conversation");
      const row = { ...checkedEntry(entry), at: now };
      const size = fs.statSync(file).size;
      let lead = "";
      if (size > 0) {
        const fd = fs.openSync(file, "r");
        try {
          const last = Buffer.alloc(1);
          fs.readSync(fd, last, 0, 1, size - 1);
          if (last[0] !== 0x0a) lead = "\n";
        } finally {
          fs.closeSync(fd);
        }
      }
      fs.appendFileSync(file, `${lead}${JSON.stringify(row)}\n`);
    },

    /** The messages in order, or null when `account` has no conversation `id`. */
    load(account, id) {
      const file = fileOf(account, id);
      const rows = file ? readRows(file) : null;
      return rows ? rows.filter((r) => !r.meta) : null;
    },

    /** `account`'s conversations, most recently active first. */
    list(account) {
      let names;
      try {
        names = fs.readdirSync(folder(account));
      } catch {
        return [];
      }
      const out = [];
      for (const name of names) {
        const id = name.replace(/\.jsonl$/, "");
        if (!name.endsWith(".jsonl") || !CONVERSATION_ID_RE.test(id)) continue;
        const rows = readRows(path.join(folder(account), name)) ?? [];
        const messages = rows.filter((r) => !r.meta);
        const created = rows.find((r) => r.meta)?.meta.created ?? 0;
        const first = messages.find((m) => m.role === "user");
        out.push({ id, title: first ? first.content.slice(0, TITLE_MAX) : "", updated: messages.at(-1)?.at ?? created });
      }
      return out.sort((a, b) => b.updated - a.updated);
    },

    /** Deletes the chat history of one conversation `account` owns; false when there is none. */
    remove(account, id) {
      const file = fileOf(account, id);
      if (!file || !fs.existsSync(file)) return false;
      fs.rmSync(file);
      return true;
    },
  };
}
