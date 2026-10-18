import { test } from "node:test";
import assert from "node:assert/strict";
import * as versions from "../../src/meta/titledb-versions.js";

// Shapes copied from blawar/titledb (Fuga: Melodies of Steel 2, trimmed).
const VERSIONS = {
  "01003f501907a000": { "65536": "2023-05-09", "983040": "2025-11-12", "131072": "2023-05-09" },
  "0100000000010000": {},
  "not-an-id": { "65536": "2020-01-01" },
};
const FW = (major, minor, micro) => (major << 26) | (minor << 20) | (micro << 16);
const CNMTS = {
  "01003f501907a000": { "0": { titleType: 128, requiredSystemVersion: FW(16, 0, 0), otherApplicationId: "01003f501907a800" } },
  "01003f501907a800": { "983040": { titleType: 129, requiredSystemVersion: FW(20, 1, 1), otherApplicationId: "01003f501907a000" } },
  "01003f501907b001": { "0": { titleType: 130, requiredApplicationVersion: 0, otherApplicationId: "01003f501907a000" } },
  "01003f501907b002": { "0": { titleType: 130, requiredApplicationVersion: 262144, otherApplicationId: "01003f501907a000" } },
};

test("latest update and its history come from versions.json, oldest first", () => {
  versions.setIndex(versions.buildIndex(VERSIONS, CNMTS));
  assert.equal(versions.latestVersion("01003F501907A000"), 983040);
  assert.deepEqual(versions.updateHistory("01003f501907a000").map((u) => u.version), [65536, 131072, 983040]);
  assert.equal(versions.updateHistory("01003F501907A000")[0].date, "2023-05-09");
  assert.equal(versions.latestVersion("0100000000010000"), null, "a game without updates has no latest version");
});

test("firmware is known per game and per update version", () => {
  versions.setIndex(versions.buildIndex(VERSIONS, CNMTS));
  assert.equal(versions.requiredFirmware("01003F501907A000", 0), "16.0.0");
  assert.equal(versions.requiredFirmware("01003F501907A800", 983040), "20.1.1");
  assert.equal(versions.requiredFirmware("01003F501907A800", 65536), null);
});

test("DLC are counted under their base and keep the update they need", () => {
  versions.setIndex(versions.buildIndex(VERSIONS, CNMTS));
  assert.equal(versions.dlcCount("01003F501907A000"), 2);
  assert.equal(versions.dlcCount("01003F501907A000", ["01003F501907B002", "01003F501907B005"]), 3,
    "DLC only the region files list are counted once");
  assert.equal(versions.requiredAppVersion("01003F501907B002", 0), 262144);
  assert.equal(versions.requiredAppVersion("01003F501907B001", 0), null, "zero means no requirement");
});

test("an index from another format version is ignored instead of misread", () => {
  versions.setIndex({ version: 99, updates: { "01003F501907A000": [[1, null]] } });
  assert.equal(versions.latestVersion("01003F501907A000"), null);
});
