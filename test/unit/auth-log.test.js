import { test } from "node:test";
import assert from "node:assert/strict";
import { refusalLine } from "../../src/security/auth-log.js";

// A refusal's log line names the reason and the path, and never what the
// console sent to prove itself: the query (a status poll may carry its keys
// there) is dropped and the device shows as its 8-character code.
test("a refusal line keeps status, reason, method and path, and drops the query and most of the device key", () => {
  const deviceKey = "AB".repeat(32);
  const line = refusalLine({ status: 401, reason: "session-revoked", method: "GET", path: `/api/pair/status?deviceKey=${deviceKey}&pairSecret=${"c3".repeat(32)}`, deviceKey });
  assert.equal(line, "401 session-revoked GET /api/pair/status device=ABABABAB");
  assert.equal(refusalLine({ status: 403, reason: "session-not-a-console", method: "GET", path: "/api/session" }), "403 session-not-a-console GET /api/session");
});
