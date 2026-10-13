import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Google's return address follows the public address saved on the admin page,
// not only the one set in env.
process.env.COOK_DATA_DIR = mkdtempSync(path.join(tmpdir(), "cook-gcb-"));
process.env.COOK_GOOGLE_REDIRECT_BASE = "";
process.env.COOK_DROPBOX_REDIRECT_BASE = "";
process.env.COOK_PUBLIC_BASE_URL = "";
const integrations = await import("../../src/security/integrations.js");
const { callbackBase } = await import("../../src/routes/web-login.js");

const req = { protocol: "http", get: (h) => (h.toLowerCase() === "host" ? "192.168.0.5:9080" : undefined), headers: { host: "192.168.0.5:9080" } };

test("without any public address the request's own origin is used", () => {
  assert.match(callbackBase(req), /192\.168\.0\.5:9080$/);
});

test("the Dropbox public address saved on the admin page is used", () => {
  integrations.save("dropbox", { appKey: "abc123def456ghi", redirectBase: "https://files.example.org/" });
  assert.equal(callbackBase(req), "https://files.example.org");
});
