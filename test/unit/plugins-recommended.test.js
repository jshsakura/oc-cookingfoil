import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { installDefaults, installRecommended } from "../../src/plugins/recommended.js";
import { createInstaller } from "../../src/plugins/installer.js";
import { packPlugin } from "../../src/plugins/pack.js";
import { makeDataDir, manifestOf, newRegistry } from "../support/plugin-fixtures.js";

// Recommended plugins come from a fixed GitHub release, checked against its published sha256, and the
// ones meant for the server's language are installed and switched on once.
async function zipOf(id, manifestId = id) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cf-reco-src-"));
  fs.writeFileSync(path.join(dir, "plugin.json"), JSON.stringify(manifestOf(manifestId, { provides: ["names"] })));
  fs.writeFileSync(path.join(dir, "index.js"), "export default {};");
  fs.writeFileSync(path.join(dir, "names.json"), JSON.stringify({ systems: {} }));
  const z = await packPlugin(dir);
  const chunks = [];
  for await (const c of z.outputStream) chunks.push(c);
  return Buffer.concat(chunks);
}

function fakeGithub(zip, { digest = null, calls = [] } = {}) {
  const sha = digest ?? crypto.createHash("sha256").update(zip).digest("hex");
  return async (url) => {
    calls.push(url);
    if (url.endsWith("/releases/latest")) {
      return new Response(JSON.stringify({ tag_name: "v0.1.0", assets: [{ name: "oc-retro-db-0.1.0.zip", size: zip.length, digest: `sha256:${sha}`, browser_download_url: "https://example.com/oc-retro-db-0.1.0.zip" }] }));
    }
    return new Response(zip);
  };
}

async function setup() {
  const d = makeDataDir();
  const { registry } = newRegistry(d, { limits: { startMs: 5000 } });
  await registry.init();
  const installer = createInstaller({ registry, dataDir: d, allowed: () => false });
  return { d, registry, installer, stateFile: path.join(d, "plugin-defaults.json") };
}

test("with Korean first, the retro database is fetched, installed and switched on once, even with uploads off", async () => {
  const { registry, installer, stateFile } = await setup();
  const calls = [];
  const fetchImpl = fakeGithub(await zipOf("oc-retro-db"), { calls });
  const r = await installDefaults({ registry, installer, lang: "ko", stateFile, fetchImpl });
  assert.deepEqual(r, [{ id: "oc-retro-db", ok: true }]);
  assert.equal(registry.stateOf("oc-retro-db"), "on");
  assert.ok(calls[0].includes("api.github.com/repos/jshsakura/oc-retro-database/releases/latest"));

  await registry.trash("oc-retro-db", {});
  assert.deepEqual(await installDefaults({ registry, installer, lang: "ko", stateFile, fetchImpl }), [], "deleted by the admin: not brought back");
});

test("another first language installs nothing", async () => {
  const { registry, installer, stateFile } = await setup();
  const calls = [];
  assert.deepEqual(await installDefaults({ registry, installer, lang: "en", stateFile, fetchImpl: fakeGithub(Buffer.alloc(1), { calls }) }), []);
  assert.equal(calls.length, 0);
});

test("a zip that does not match GitHub's sha256 is refused and tried again on the next start", async () => {
  const { registry, installer, stateFile } = await setup();
  const zip = await zipOf("oc-retro-db");
  const r = await installDefaults({ registry, installer, lang: "ko", stateFile, fetchImpl: fakeGithub(zip, { digest: "0".repeat(64) }) });
  assert.equal(r[0].ok, false);
  assert.equal(registry.list().some((p) => p.id === "oc-retro-db"), false);
  assert.equal(fs.existsSync(stateFile), false);
  assert.equal((await installDefaults({ registry, installer, lang: "ko", stateFile, fetchImpl: fakeGithub(zip) }))[0].ok, true);
});

test("a release whose plugin has another id is refused, and an unlisted id cannot be fetched", async () => {
  const { registry, installer } = await setup();
  await assert.rejects(installRecommended("oc-retro-db", { registry, installer, fetchImpl: fakeGithub(await zipOf("oc-retro-db", "something-else")) }), { code: "bad-package" });
  assert.equal(registry.list().length, 0);
  await assert.rejects(installRecommended("not-listed", { registry, installer, fetchImpl: fakeGithub(Buffer.alloc(1)) }), { code: "not-found" });
});

test("an upload is still refused while installing is switched off", async () => {
  const { installer } = await setup();
  await assert.rejects(installer.stage(await zipOf("oc-retro-db")), { code: "install-off" });
});
