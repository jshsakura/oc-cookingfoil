import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTrustProxy } from "../../src/helpers/trust-proxy.js";

test("trust proxy keeps the boolean spellings", () => {
  assert.equal(parseTrustProxy("true"), true);
  assert.equal(parseTrustProxy("off"), false);
  assert.equal(parseTrustProxy(""), false);
  assert.equal(parseTrustProxy(undefined), false);
});

test("trust proxy passes a hop list through for express", () => {
  assert.equal(parseTrustProxy(" loopback, uniquelocal "), "loopback, uniquelocal");
});
