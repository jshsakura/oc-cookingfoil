import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

// composeSections() builds the native `/api/shop/sections` view CyberFoil
// v1.4.5+ prefers. Unlike the legacy flat index (which stamps `[TID][vVER]`
// onto `name` so the client can scrape it back out), the native view hands
// the client CLEAN names + first-class fields. These probes assert the schema
// and the field derivation so titles render full info instead of the degraded
// name-token fallback.

const PROBE = `
  import { composeSections } from "../../src/create-index-content.js";
  const filesMap = new Map([
    ["Mario [0100000000010000][v0].nsp",
      { url: "../Mario.nsp", name: "Mario [0100000000010000][v0]", size: 123 }],
    ["Zelda Update [0100000000010800][v131072].nsp",
      { url: "../Zelda.nsp", name: "Zelda [0100000000010800][v131072]", size: 456 }],
    ["Homebrew.nro",
      { url: "../Homebrew.nro", name: "Homebrew", size: 7 }],
  ]);
  const customs = [
    { titleId: "0100000000099000", name: "Custom", url: "../Custom.nsp", size: 9 },
    { titleId: "0100000000099001", name: "NoUrlRow" }, // url-less → skipped
  ];
  process.stdout.write(JSON.stringify(composeSections(filesMap, customs)));
`;

function run() {
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", PROBE], {
    cwd: import.meta.dirname,
    env: { ...process.env, COOK_EXTRACT_ICONS: "off" },
    encoding: "utf-8",
  });
  return JSON.parse(out);
}

test("composeSections: single 'all' section wrapping every item", () => {
  const r = run();
  assert.equal(r.sections.length, 1);
  assert.equal(r.sections[0].id, "all");
  assert.equal(r.sections[0].title, "All");
});

test("composeSections: base item carries clean name + first-class fields", () => {
  const item = run().sections[0].items.find((i) => i.title_id === "0100000000010000");
  assert.ok(item, "base item present");
  assert.equal(item.name, "Mario"); // clean — no [TID][vVER] suffix
  assert.ok(!item.name.includes("["), "name has no bracket tokens");
  assert.equal(item.app_id, "0100000000010000");
  assert.equal(item.app_version, 0);
  assert.equal(item.app_type, "base");
  assert.equal(item.size, 123);
  assert.ok(
    item.icon_url.startsWith("/api/shop/icon/0100000000010000"),
    "relative icon_url (route applies origin rewrite)"
  );
});

test("composeSections: update file is typed and versioned from the filename", () => {
  const item = run().sections[0].items.find((i) => i.title_id === "0100000000010800");
  assert.ok(item);
  assert.equal(item.app_type, "update");
  assert.equal(item.app_version, 131072);
});

test("composeSections: base_title_id groups base + update under one base key", () => {
  // M2c grouping needs the client to collapse base + update + dlc into one
  // base card. The section item carries the derived group key so the client
  // groups without re-deriving it from the (clean, token-less) name.
  const items = run().sections[0].items;
  const base = items.find((i) => i.title_id === "0100000000010000");
  const upd = items.find((i) => i.title_id === "0100000000010800");
  assert.equal(base.base_title_id, "0100000000010000"); // base groups under itself
  assert.equal(upd.base_title_id, "0100000000010000"); // update collapses to base
});

test("composeSections: title-less homebrew still lists (name/url/size only)", () => {
  const item = run().sections[0].items.find((i) => i.name === "Homebrew");
  assert.ok(item);
  assert.equal(item.url, "../Homebrew.nro");
  assert.equal(item.title_id, undefined); // no title id → no title fields
});

test("composeSections: custom row with url included, url-less custom skipped", () => {
  const items = run().sections[0].items;
  assert.ok(items.find((i) => i.title_id === "0100000000099000"), "url custom present");
  assert.equal(
    items.find((i) => i.name === "NoUrlRow"),
    undefined,
    "url-less custom skipped (native sections require url)"
  );
});
