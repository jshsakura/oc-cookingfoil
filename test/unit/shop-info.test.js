import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";

function probe(env, before = "", req = "{}") {
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", `
    import route from "../../src/routes/shop-info.js";
    ${before}
    const res = { headers: {} };
    res.header = (k, v) => { res.headers[k] = v; return res; };
    res.json = (body) => { res.body = body; return res; };
    await route(${req}, res);
    process.stdout.write(JSON.stringify(res.body));
  `], {
    cwd: import.meta.dirname,
    env: { ...process.env, COOK_DATA_DIR: mkdtempSync(path.join(tmpdir(), "cf-info-")), ...env },
    encoding: "utf-8",
  });
  return JSON.parse(out);
}

test("shop info lists the optional fields a client may rely on", () => {
  const info = probe({ COOK_DEVICE_PAIRING: "false" });
  assert.equal(info.name, "CookingFoil");
  assert.equal(info.apiVersion, 1);
  assert.match(info.version, /^\d+\.\d+\.\d+/);
  for (const feature of ["item-install-size", "item-integrity", "item-required-firmware", "item-version-name"]) {
    assert.ok(info.features.includes(feature), feature);
  }
  assert.ok(!info.features.includes("device-pairing"), "pairing is only listed when it is switched on");
  assert.deepEqual(info.contentMeta, { read: 0, pending: 0 });
  assert.match(info.server_id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, "an id for this installation");
  assert.ok(info.features.includes("server-id"));
});

test("shop info lists admin-edit only to a console the admin flagged", () => {
  const KEY = "AB".repeat(32);
  const setup = `
    const store = await import("../../src/security/store.js");
    await store.load();
    store.approveDevice("${KEY}", { label: "a", addedBy: "admin", accessKeyHash: "h" });
    store.approveDevice("${"CD".repeat(32)}", { label: "b", addedBy: "admin", accessKeyHash: "h" });
    store.setDeviceAdmin("${KEY}", true);`;
  const env = { COOK_DEVICE_PAIRING: "true" };
  assert.ok(probe(env, setup, `{ pairedDevice: "${KEY}" }`).features.includes("admin-edit"));
  assert.ok(!probe(env, setup, `{ pairedDevice: "${"CD".repeat(32)}" }`).features.includes("admin-edit"));
  assert.ok(!probe(env, setup, `{ auth: { user: "alice" } }`).features.includes("admin-edit"), "a browser");
});

test("shop info lists device pairing when the server offers it", () => {
  assert.ok(probe({ COOK_DEVICE_PAIRING: "true" }).features.includes("device-pairing"));
  assert.ok(probe({ COOK_DEVICE_PAIRING: "true" }).features.includes("device-rebind"));
});

test("shop info lists homebrew only while at least one app is listed", () => {
  const nothing = path.join(tmpdir(), "cf-no-homebrew-here");
  const refresh = `await (await import("../../src/routes/homebrew.js")).refreshManual();`;
  assert.ok(!probe({ COOK_HOMEBREW_DIR: nothing, COOK_HOMEBREW_REPOS: "" }, refresh).features.includes("homebrew"));

  // A repository that has not been fetched yet, or an empty folder, lists nothing.
  const empty = mkdtempSync(path.join(tmpdir(), "cf-homebrew-"));
  assert.ok(!probe({ COOK_HOMEBREW_DIR: empty, COOK_HOMEBREW_REPOS: "murat303/ytb-player" }, refresh).features.includes("homebrew"));

  // A hand-placed app.
  const folder = mkdtempSync(path.join(tmpdir(), "cf-homebrew-"));
  mkdirSync(path.join(folder, "tool"));
  writeFileSync(path.join(folder, "tool", "tool.nro"), fakeNro("Tool", "1.0"));
  assert.ok(probe({ COOK_HOMEBREW_DIR: folder, COOK_HOMEBREW_REPOS: "" }, refresh).features.includes("homebrew"));

  // A repository whose build the server already knows.
  const data = mkdtempSync(path.join(tmpdir(), "cf-info-"));
  const id = "gh-" + createHash("sha256").update("murat303/ytb-player").digest("hex").slice(0, 12);
  mkdirSync(path.join(data, "homebrew", id), { recursive: true });
  writeFileSync(path.join(data, "homebrew", id, "state.json"), JSON.stringify({
    repo: "murat303/ytb-player", checked_at: Date.now(), tag: "v1.1.0", released_at: null,
    asset: { id: 1, name: "ytb-player.nro", size: 10, url: "https://github.com/x", digest: null },
    cached: { asset_id: 1, file: "ytb-player.nro", sha256: "ab", name: "YTB Player", author: null, version: "1.1.0" },
  }));
  assert.ok(probe({ COOK_DATA_DIR: data, COOK_HOMEBREW_DIR: nothing, COOK_HOMEBREW_REPOS: "murat303/ytb-player" }).features.includes("homebrew"));
});

/** A minimal NRO whose NACP carries a name and a version. */
function fakeNro(name, version) {
  const head = Buffer.alloc(0x100);
  head.write("NRO0", 0x10);
  head.writeUInt32LE(0x100, 0x18);
  const aset = Buffer.alloc(0x38);
  aset.write("ASET", 0);
  aset.writeBigUInt64LE(0x38n, 0x18);
  aset.writeBigUInt64LE(0x4000n, 0x20);
  const nacp = Buffer.alloc(0x4000);
  nacp.write(name, 0);
  nacp.write(version, 0x3060);
  return Buffer.concat([head, aset, nacp]);
}

test("shop info lists nca-rewrap and how far the keys reach only while the server has prod.keys", () => {
  const without = probe({ COOK_PROD_KEYS_PATH: path.join(tmpdir(), "cf-no-keys-here", "prod.keys") });
  assert.ok(!without.features.includes("nca-rewrap"));
  assert.equal(without.rewrapMaxGen, undefined);
  assert.ok(without.features.includes("item-key-generation"), "the item fields are listed either way");

  const dir = mkdtempSync(path.join(tmpdir(), "cf-keys-"));
  const file = path.join(dir, "prod.keys");
  writeFileSync(file, [`header_key = ${"a".repeat(64)}`, `key_area_key_application_0d = ${"b".repeat(32)}`, `titlekek_0d = ${"c".repeat(32)}`].join("\n"));
  const info = probe({ COOK_PROD_KEYS_PATH: file });
  assert.ok(info.features.includes("nca-rewrap"));
  assert.equal(info.rewrapMaxGen, 13);
  assert.equal(info.rewrapMaxFirmware, "14.0.0");
  assert.ok(!JSON.stringify(info).includes("a".repeat(32)), "no key value");
});
