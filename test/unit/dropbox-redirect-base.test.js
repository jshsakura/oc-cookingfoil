import { test } from "node:test";
import assert from "node:assert/strict";

process.env.COOK_DROPBOX_APP_KEY = "test-app-key";
process.env.COOK_DROPBOX_REDIRECT_BASE = "https://files.example.org/";
const { redirectUriFor } = await import("../../src/routes/dropbox-bridge.js");

test("the Dropbox callback uses its own public address, whatever host the console used", () => {
  const lan = { protocol: "http", get: (h) => (h.toLowerCase() === "host" ? "192.168.0.10:9080" : undefined), headers: {} };
  assert.equal(redirectUriFor(lan), "https://files.example.org/api/dropbox/oauth/dropbox/callback");
});
