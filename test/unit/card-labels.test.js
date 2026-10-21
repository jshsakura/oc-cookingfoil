import { test } from "node:test";
import assert from "node:assert/strict";
import { SWITCH_LABELS, RETRO_LABELS, attachSwitchLabels, retroLabels } from "../../src/meta/card-labels.js";

const BASE = "0100000000010000";
const UPD = "0100000000010800";
const item = (app_type, over = {}) => ({ base_title_id: BASE, title_id: app_type === "update" ? UPD : BASE, app_type, app_version: 0, ...over });
const labelsOf = (items) => attachSwitchLabels(items).find((i) => i.app_type === "base").labels;

test("a base card is labelled in the client's order from what its whole game holds", () => {
  const items = [
    item("base", { korean_patches: 2, required_patches: 1, latest_version: 131072, price_discount: "₩10,000" }),
    item("update", { app_version: 65536 }),
    item("update", { app_version: 131072 }),
    item("dlc"), item("dlc"), item("dlc"),
  ];
  assert.deepEqual(labelsOf(items), ["korean-patch", "required-patch", "latest", "sale", ["dlc", "3"]]);
});

test("the file-state slot holds one label: damaged, then modified, then latest or update", () => {
  assert.deepEqual(labelsOf([item("base", { latest_version: 131072 }), item("update", { app_version: 65536 })]), ["update"]);
  assert.deepEqual(labelsOf([item("base"), item("update", { app_version: 65536 })]), ["update"], "no known latest version is not the latest");
  assert.deepEqual(labelsOf([item("base"), item("dlc", { integrity: "modified" }), item("update", { integrity: "damaged" })]), ["damaged", ["dlc", "1"]]);
  assert.deepEqual(labelsOf([item("base", { integrity: "modified" }), item("update")]), ["modified"]);
  assert.equal(labelsOf([item("base")]), undefined, "a bare game carries no labels field");
});

test("updates and DLC carry no labels of their own", () => {
  const items = attachSwitchLabels([item("base", { korean_patches: 1 }), item("update"), item("dlc")]);
  assert.deepEqual(items.filter((i) => i.labels).map((i) => i.app_type), ["base"]);
});

test("a retro card shows achievements, Korean, year and players", () => {
  assert.deepEqual(retroLabels({ achievements: { count: 40, matchedBy: "hash" }, korean: true, year: 1995, players: 2 }),
    [["achievements", "40"], "korean", ["year", "1995"], ["players", "2"]]);
  assert.deepEqual(retroLabels({ achievements: { count: 12, matchedBy: "title" }, players: 1 }), [["achievements-title", "12"]]);
  assert.deepEqual(retroLabels({}), []);
});

test("every label has its text in four languages, a known tone and a known icon", () => {
  const ICONS = new Set("home search grid refresh download gear check back forward filter calendar building users inbox tag file globe hash branch layers package info alert trophy sparkle clock star wrench shield user volume upload image thumbs-up thumbs-down joystick".split(" "));
  for (const [key, l] of Object.entries({ ...SWITCH_LABELS, ...RETRO_LABELS })) {
    assert.match(key, /^[a-z0-9-]+$/);
    for (const lang of ["en", "ko", "ja", "zh"]) assert.ok(l[lang], `${key} ${lang}`);
    assert.ok(["accent", "neutral", "good", "warn", "bad"].includes(l.tone), key);
    assert.ok(!l.icon || ICONS.has(l.icon), key);
    assert.equal(typeof l.order, "number");
  }
});
