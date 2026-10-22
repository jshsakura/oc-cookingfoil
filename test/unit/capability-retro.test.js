import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.COOK_DATA_DIR = mkdtempSync(path.join(tmpdir(), "cook-capability-retro-"));
const { registry } = await import("../../src/capabilities/registry.js");
const { LEGACY_UNREGISTERED, OPT_OUT } = await import("../../src/capabilities/opt-out.js");

test("the retro requirements route is a read tool an automation token can call", () => {
  const key = "GET /admin/api/retro/requirements";
  const cap = registry.byRoute(key);
  assert.equal(cap?.id, "retro_requirements");
  assert.equal(cap.safety, "read");
  assert.equal(cap.token, true);
  assert.ok(!LEGACY_UNREGISTERED.includes(key) && !(key in OPT_OUT), "not also listed as unregistered");
});
