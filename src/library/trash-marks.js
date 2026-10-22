/**
 * What people and the admin said about an item, kept with it in the trash and
 * put back when it is restored: the 검수됨 mark and the 잘 돼요 / 안 돼요 votes
 * of a patch or save, and everything an admin attached to a hand-placed
 * homebrew app (its pictures' record and kept originals, its own description,
 * the tool or port choice, CPU cores, the 검수됨 mark, the hidden mark, the
 * votes). Removing an item still forgets these, so an unrelated item that later
 * gets the same id starts clean; only a restore brings them back, under the id
 * the restored item has now.
 */
import fs from "fs";
import * as itemVerified from "../meta/item-verified.js";
import * as itemVotes from "../meta/item-votes.js";

/** { kind, verifiedAt, votes } of a patch or save, or null when there is nothing to keep. */
export function marksOf(kind, id) {
  const verifiedAt = itemVerified.KINDS.includes(kind) ? itemVerified.verifiedAt(kind, id) : null;
  const votes = itemVotes.KINDS.includes(kind) ? itemVotes.votesOf(kind, id) : {};
  return verifiedAt === null && !Object.keys(votes).length ? null : { kind, verifiedAt, votes };
}

/** Forgets the marks of a removed or moved item. */
export function forgetMarks(kind, id) {
  if (itemVerified.KINDS.includes(kind)) itemVerified.set(kind, id, false);
  if (itemVotes.KINDS.includes(kind)) itemVotes.forget(kind, id);
}

/** Puts kept marks back on the item `id` (what it has now wins). */
export function putMarks(marks, id) {
  if (!marks || !id) return;
  if (Number.isFinite(marks.verifiedAt) && itemVerified.KINDS.includes(marks.kind)) itemVerified.set(marks.kind, id, true, marks.verifiedAt);
  if (marks.votes) itemVotes.restore(marks.kind, id, marks.votes);
}

// ── a hand-placed homebrew app ───────────────────────────────────────
const hb = async () => ({
  media: await import("../meta/homebrew-media.js"),
  descriptions: await import("../meta/homebrew-descriptions.js"),
  kinds: await import("../meta/homebrew-kinds.js"),
  cores: await import("../meta/homebrew-cores.js"),
  verified: await import("../meta/homebrew-verified.js"),
  disabled: await import("../meta/homebrew-disabled.js"),
});

/** Everything kept about a homebrew app, and the folder of its server-side pictures (to copy into the trash). */
export async function homebrewExtrasOf(id) {
  const m = await hb();
  const own = m.media.ownDir(id);
  return {
    fields: {
      id,
      media: m.media.record(id),
      description: m.descriptions.get(id),
      kind: m.kinds.kindOf(id),
      cores: m.cores.coresOf(id),
      verifiedAt: m.verified.verifiedAt(id),
      disabled: m.disabled.isDisabled(id),
      votes: itemVotes.votesOf("homebrew", id),
    },
    mediaDir: fs.existsSync(own) ? own : null,
  };
}

/** Puts a homebrew app's kept extras back under `id` (what it has now wins). `mediaDir`: the copy kept in the trash. */
export async function putHomebrewExtras(fields, id, mediaDir = null) {
  if (!fields || !id) return;
  const m = await hb();
  await m.media.adopt(id, fields.media ?? {}, mediaDir);
  if (fields.description && !m.descriptions.get(id)) m.descriptions.set(id, fields.description);
  if (fields.kind === "port" && m.kinds.kindOf(id) === "tool") m.kinds.set(id, "port");
  if (fields.cores && fields.cores !== m.cores.coresOf(id) && m.cores.coresOf(id) === 3) m.cores.set(id, fields.cores);
  if (Number.isFinite(fields.verifiedAt)) m.verified.set(id, true, fields.verifiedAt);
  if (fields.disabled) m.disabled.setEnabled(id, false);
  if (fields.votes) itemVotes.restore("homebrew", id, fields.votes);
}
