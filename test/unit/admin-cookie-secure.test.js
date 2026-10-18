import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.COOK_DATA_DIR = mkdtempSync(path.join(tmpdir(), "cook-admincookie-"));
const { issueSession, clearSession } = await import("../../src/security/admin-session.js");

function cookieFor(req, fn) {
  let line = null;
  fn({ req, setHeader: (k, v) => { if (k === "Set-Cookie") line = v; } });
  return line;
}
const reqOf = (secure, proto) => ({ secure, get: (n) => (n.toLowerCase() === "x-forwarded-proto" ? proto : undefined) });

test("the admin session cookie is Secure over https, like the account cookie", () => {
  assert.match(cookieFor(reqOf(true), issueSession), /; Secure$/);
  assert.match(cookieFor(reqOf(false, "https"), issueSession), /; Secure$/, "https at the proxy counts");
  assert.doesNotMatch(cookieFor(reqOf(false, "http"), issueSession), /Secure/, "plain http on the LAN keeps working");
  assert.match(cookieFor(reqOf(true), clearSession), /Max-Age=0; Secure$/);
  assert.match(cookieFor(reqOf(false), issueSession), /^cf_admin=[^;]+; HttpOnly; SameSite=Strict; Path=\/admin; Max-Age=\d+$/);
});
