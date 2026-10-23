/**
 * What a ROM patch refuses with: an English message for the log and a `code` the admin
 * API turns into words in the page's language (routes/admin/api-words.js "retroPatch.<code>").
 * `status` is the HTTP status the admin route answers with.
 */
export class RomPatchError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** A patch file whose bytes do not follow its format. */
export const broken = (format, why) => new RomPatchError("bad-patch", `${format} patch is broken: ${why}`);
