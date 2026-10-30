import { test } from "node:test";
import assert from "node:assert/strict";
import { chdFirstTrack, chdtrackBin } from "../../src/helpers/chd-track.js";
import { createDropHasher } from "../../src/meta/drop-hash.js";

const said = (text) => async () => text;

test("the first track chdtrack prints is read as crc and size", async () => {
  assert.deepEqual(await chdFirstTrack("a.chd", { bin: "chdtrack", exec: said("6ea8ee5b 147500976\n") }), [{ crc32: "6ea8ee5b", size: 147500976 }]);
});

test("with no chdtrack, a failure or odd output, nothing is hashed", async () => {
  assert.deepEqual(await chdFirstTrack("a.chd", { bin: null }), []);
  assert.deepEqual(await chdFirstTrack("a.chd", { bin: "chdtrack", exec: said(null) }), []);
  assert.deepEqual(await chdFirstTrack("a.chd", { bin: "chdtrack", exec: said("not a hash") }), []);
  assert.deepEqual(await chdFirstTrack("a.chd", { bin: "chdtrack", exec: async () => { throw new Error("boom"); } }), []);
});

test("the drop box names a .chd by the dump its first track matches, and leaves it when chdtrack cannot read it", async () => {
  const lookup = (c) => (c === "6ea8ee5b" ? [{ system: "segacd", name: "Some Game (USA)", size: 147500976 }] : []);
  const systems = { segacd: { id: "segacd" } };
  const files = [{ rel: "game.chd", abs: "/nowhere/game.chd", size: 3, mtimeMs: 1 }];
  const named = await createDropHasher({ lookup, chdTrack: (abs) => chdFirstTrack(abs, { bin: "chdtrack", exec: said("6ea8ee5b 147500976") }) }).identify(files, new Map(), systems);
  assert.deepEqual([...named.entries()].map(([rel, v]) => [rel, v.systems, v.name]), [["game.chd", ["segacd"], "Some Game (USA)"]]);
  const none = await createDropHasher({ lookup, chdTrack: (abs) => chdFirstTrack(abs, { bin: null }) }).identify(files, new Map(), systems);
  assert.equal(none.size, 0);
});

test("without COOK_CHDTRACK_BIN the program is looked for once, not for every file", () => {
  let probes = 0;
  const probe = () => { probes++; return {}; };
  assert.equal(chdtrackBin({}, probe), "chdtrack");
  assert.equal(chdtrackBin({}, probe), "chdtrack");
  assert.equal(probes, 1);
  assert.equal(chdtrackBin({ COOK_CHDTRACK_BIN: "/opt/chdtrack" }, probe), "/opt/chdtrack");
  assert.equal(probes, 1);
});
