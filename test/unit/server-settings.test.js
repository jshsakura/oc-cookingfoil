import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Server behaviour set on the admin page: saved over compose, applied at once
// to every module that imported it, and back to compose when cleared.
const dir = mkdtempSync(path.join(tmpdir(), "cook-ss-"));
process.env.COOK_DATA_DIR = dir;
process.env.COOK_DEVICE_PAIRING = "false";
process.env.COOK_DEVICE_AUTO_APPROVE = "true";
process.env.COOK_UPLOADS_ENABLED = "false";
process.env.COOK_PUBLIC_BASE_URL = "";
process.env.COOK_LANG_PRIORITY = "ko,en";
const env = await import("../../src/helpers/envs.js");
const settings = await import("../../src/security/server-settings.js");
const { getRegionsFromEnv, DEFAULT_REGIONS, DEFAULT_SOURCE, titledbBase, fetchRegion } = await import("../../src/meta/titledb-fetcher.js");

test("with nothing saved every setting is the compose value", () => {
  const d = settings.describe();
  assert.equal(d.devicePairing.value, false);
  assert.equal(d.devicePairing.source, "env");
  assert.equal(d.deviceApproval.value, "signin");
  assert.deepEqual(d.langPriority.value, ["ko", "en"]);
  assert.equal(d.publicBaseUrl.value, "");
});

test("a saved value applies at once to importers and is kept in a private file", () => {
  const changed = settings.save({ devicePairing: true, deviceApproval: "manual", uploadsEnabled: true, publicBaseUrl: "https://files.example.org/" });
  assert.deepEqual(changed.sort(), ["deviceApproval", "devicePairing", "publicBaseUrl", "uploadsEnabled"]);
  assert.equal(env.devicePairing, true);
  assert.equal(env.deviceAutoApprove, false);
  assert.equal(env.deviceAutoApproveAll, false);
  assert.equal(env.uploadsEnabled, true);
  assert.equal(env.publicBaseUrl, "https://files.example.org");
  const file = path.join(dir, "security", "server-settings.json");
  assert.equal(JSON.parse(readFileSync(file, "utf8")).settings.devicePairing, true);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  const d = settings.describe().devicePairing;
  assert.deepEqual([d.value, d.source, d.envValue], [true, "saved", false]);
});

test("'all' approves every console; null goes back to compose", () => {
  settings.save({ deviceApproval: "all" });
  assert.equal(env.deviceAutoApproveAll, true);
  settings.save({ deviceApproval: null, devicePairing: null });
  assert.equal(env.deviceAutoApprove, true);
  assert.equal(env.deviceAutoApproveAll, false);
  assert.equal(env.devicePairing, false);
  assert.equal(settings.describe().devicePairing.source, "env");
});

test("lists are split on commas, and the titledb regions follow the saved ones", () => {
  settings.save({ langPriority: " ja , en ", titledbRegions: "KR.ko,US.en" });
  assert.deepEqual(env.langPriority, ["ja", "en"]);
  assert.deepEqual(getRegionsFromEnv(), ["KR.ko", "US.en"]);
  settings.save({ titledbRegions: "" });
  assert.deepEqual(getRegionsFromEnv(), DEFAULT_REGIONS);
});

test("titledb is read from the address set on the admin page, blawar/titledb when it is empty", async () => {
  assert.equal(titledbBase(), DEFAULT_SOURCE);
  assert.equal(settings.describe().titledbSource.value, "");
  settings.save({ titledbSource: " https://mirror.example.org/titledb/ " });
  assert.equal(titledbBase(), "https://mirror.example.org/titledb");
  // The next fetch goes there.
  const asked = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => { asked.push(String(url)); return new Response("{}", { status: 200 }); };
  try {
    await fetchRegion("KR.ko", path.join(dir, "titledb"));
  } finally {
    globalThis.fetch = real;
  }
  assert.deepEqual(asked, ["https://mirror.example.org/titledb/KR.ko.json"]);
  settings.save({ titledbSource: "" });
  assert.equal(titledbBase(), DEFAULT_SOURCE);
});

test("a value that doesn't fit is refused and nothing is saved", () => {
  const before = settings.describe();
  for (const bad of [
    { devicePairing: "yes" }, { deviceApproval: "everyone" }, { publicBaseUrl: "files.example.org" },
    { langPriority: "" }, { langPriority: "ko;rm" }, { titledbRegions: "kr" }, { extractIcons: "some" },
    { welcomeMessage: "two\nlines" }, { titledbSource: "mirror.example.org" }, { titledbSource: "ftp://x/y" }, { nope: true },
    { downloadMaxConnections: 0 }, { downloadMaxConnections: 9 }, { downloadMaxConnections: 2.5 }, { downloadMaxConnections: "many" },
  ]) assert.throws(() => settings.save({ ...bad, uploadsEnabled: false }), undefined, JSON.stringify(bad));
  assert.deepEqual(settings.describe(), before);
});

test("the per-console connection count is 4 unless the admin picks another, and applies at once", () => {
  assert.equal(settings.describe().downloadMaxConnections.value, 4);
  assert.equal(env.downloadMaxConnections, 4);
  assert.deepEqual(settings.save({ downloadMaxConnections: "6" }), ["downloadMaxConnections"], "the page's select sends a string");
  assert.equal(env.downloadMaxConnections, 6);
  settings.save({ downloadMaxConnections: null });
  assert.equal(env.downloadMaxConnections, 4, "back to compose");
});

test("a saved file is read back on start", () => {
  settings.save({ ratingSync: false, eshopArtwork: false });
  settings.load();
  assert.equal(env.ratingSync, false);
  assert.equal(env.eshopArtwork, false);
});

test("the share inbox switch and its two sizes are saved in bytes and apply at once", () => {
  assert.equal(settings.describe().inboxEnabled.value, true);
  settings.save({ inboxEnabled: false, inboxMaxBytes: "1073741824", inboxQuotaBytes: 5 * 1024 ** 3 });
  assert.equal(env.inboxEnabled, false);
  assert.equal(env.inboxMaxBytes, 1024 ** 3);
  assert.equal(env.inboxQuotaBytes, 5 * 1024 ** 3);
  for (const bad of [0, -1, 1.5, "abc", "", true]) assert.throws(() => settings.save({ inboxMaxBytes: bad }), /inboxMaxBytes/, String(bad));
  settings.save({ inboxEnabled: null, inboxMaxBytes: null, inboxQuotaBytes: null });
  assert.equal(env.inboxEnabled, true);
  assert.equal(env.inboxMaxBytes, 2 * 1024 ** 3);
});
