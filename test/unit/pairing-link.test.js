import { test } from "node:test";
import assert from "node:assert/strict";
import { issuePairLink, readPairLink, finishPairLink } from "../../src/security/pairing-link.js";

const DEVICE = "A".repeat(64);
test("QR links are stable, expire, and never contain the device's credential", () => {
  const first = issuePairLink(DEVICE, 1000);
  assert.match(first.token, /^[a-f0-9]{32}$/);
  assert.ok(!first.token.includes(DEVICE));
  assert.deepEqual(issuePairLink(DEVICE, 2000), first);
  assert.equal(readPairLink(first.token, 2000).deviceKey, DEVICE);
  assert.equal(readPairLink("invalid", 2000), null);
  assert.equal(readPairLink(first.token, first.expiresAt), null);
  const replacement = issuePairLink(DEVICE, first.expiresAt);
  assert.notEqual(replacement.token, first.token);
});

test("QR approvals consume the request once and cannot rotate a later key", () => {
  const link = issuePairLink("B".repeat(64), 1000);
  assert.equal(finishPairLink(link.token, 2000), true);
  assert.equal(readPairLink(link.token, 2000).used, true);
  assert.equal(finishPairLink(link.token, 2000), false);
  assert.equal(finishPairLink("invalid", 2000), false);
  assert.notEqual(issuePairLink("B".repeat(64), 3000).token, link.token);
});

test("the console's code finds its live request, and only until it is approved", async () => {
  const { findPairLinkByCode } = await import("../../src/security/pairing-link.js");
  const link = issuePairLink("C".repeat(64));
  assert.equal(findPairLinkByCode(link.code).token, link.token);
  assert.equal(findPairLinkByCode(` ${link.code.slice(0, 4).toLowerCase()}-${link.code.slice(4)} `).token, link.token);
  assert.equal(findPairLinkByCode("nothex!!"), null);
  finishPairLink(link.token);
  assert.equal(findPairLinkByCode(link.code), null);
});
