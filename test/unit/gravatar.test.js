import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { gravatarUrl } from "../../src/helpers/gravatar.js";

test("a Gravatar URL carries the SHA-256 of the trimmed, lower-cased email and never the address", () => {
  const url = gravatarUrl("  Someone@Example.com ");
  const hash = crypto.createHash("sha256").update("someone@example.com").digest("hex");
  assert.equal(url, `https://gravatar.com/avatar/${hash}?s=80&d=404`);
  assert.ok(!url.includes("example"));
  assert.equal(gravatarUrl(""), null);
  assert.equal(gravatarUrl(undefined), null);
});
