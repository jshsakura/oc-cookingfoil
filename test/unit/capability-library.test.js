import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.COOK_DATA_DIR = mkdtempSync(path.join(tmpdir(), "cook-capability-library-"));
const { registry } = await import("../../src/capabilities/registry.js");
const { LEGACY_UNREGISTERED, OPT_OUT } = await import("../../src/capabilities/opt-out.js");

test("both storage guide routes are read tools an automation token can call", () => {
  for (const [key, id] of [["GET /admin/api/storage-guide", "library_storage_guide"], ["GET /admin/api/storage-guide/folder", "library_folder_guide"]]) {
    const cap = registry.byRoute(key);
    assert.equal(cap?.id, id, key);
    assert.equal(cap.safety, "read");
    assert.equal(cap.access, "read");
    assert.equal(cap.token, true, `${key} is open to tokens`);
    assert.ok(!LEGACY_UNREGISTERED.includes(key) && !(key in OPT_OUT), `${key} is not also listed as unregistered`);
  }
});

test("the guide tools return what the admin API serves", async () => {
  const all = await registry.byId("library_storage_guide").handler({}, {});
  assert.ok(all.guides.length > 0);
  assert.match(all.text, /\S/);
  const folder = registry.byId("library_folder_guide");
  const one = await folder.handler({}, { path: all.guides[0].path });
  assert.equal(one.guide.path, all.guides[0].path);
  assert.deepEqual(await folder.handler({}, { path: "../games" }), { error: "bad-path" });
  const unknown = await folder.handler({}, { path: "no/such/folder" });
  assert.equal(unknown.error, "unknown");
  assert.ok(unknown.known.includes(all.guides[0].path));
});
