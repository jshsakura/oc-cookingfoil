import { test } from "node:test";
import assert from "node:assert/strict";
import { groupCatalog, selectCatalog, safeUrl, versionLabel } from "../../src/views/assets/catalog.js";

const item = (type, version = 0, extra = {}) => ({
  url: `https://shop.example.com/${type}-${version}.nsz`, name: type,
  base_title_id: "0100000000010000", title_id: type === "dlc" ? "0100000000011001" : "0100000000010000",
  app_type: type, app_version: version, size: 10, ...extra,
});

test("web catalog groups unordered bases, newest updates and distinct DLC without mutating source", () => {
  const input = [item("dlc", 2), item("update", 1), item("base", 0, { name: "본편", size: 20 }),
    item("update", 3), item("dlc", 1), item("base", 0, { name: "작은 본편", size: 12 }),
    item("dlc", 0, { title_id: "0100000000011002", url: "https://shop.example.com/dlc2.nsz" })];
  const before = structuredClone(input);
  const [group] = groupCatalog(input);
  assert.equal(group.name, "작은 본편");
  assert.equal(group.base.size, 12);
  assert.equal(group.alternatives.length, 1);
  assert.equal(group.update.app_version, 3);
  assert.equal(group.dlc.length, 2);
  assert.equal(group.dlc[0].app_version, 2);
  assert.deepEqual(input, before);
});
test("web catalog retains base-less, custom and title-less DLC groups", () => {
  const groups = groupCatalog([item("update", 7),
    { name: "Custom", url: "https://shop.example.com/custom.nro" },
    { name: "Custom 2", url: "https://shop.example.com/custom2.nro" },
    item("dlc", 1, { title_id: undefined, url: "https://shop.example.com/addon.nsp" })]);
  assert.equal(groups.length, 3);
  assert.equal(groups[0].base, null);
  assert.equal(groups[0].dlc.length, 1);
  assert.deepEqual(groupCatalog([]), []);
});
test("web catalog uses real language lists, newest added time and actual version labels", () => {
  const groups = groupCatalog([item("base", 0, { languages: ["ko", "en"], added_at: 100 }),
    item("update", 4, { added_at: 200 }),
    item("base", 0, { base_title_id: "0100000000020000", name: "한국어 이름만 있는 게임", region: "KR" })]);
  assert.equal(selectCatalog(groups, { filter: "ko", sort: "recent" }).length, 1);
  assert.equal(selectCatalog(groups, { query: "한국어 이름만" }).length, 1);
  assert.equal(groups[0].addedAt, 200);
  assert.equal(versionLabel(item("update", 131072)), "v131072");
  assert.equal(versionLabel(item("update", 4, { version_name: "1.4.1" })), "v1.4.1");
});
test("web catalog prevents active URL schemes while retaining download paths", () => {
  assert.equal(safeUrl("javascript:alert(1)"), "");
  assert.equal(safeUrl("data:text/html,x"), "");
  assert.equal(safeUrl("/api/shop/icon/0100000000010000"), "/api/shop/icon/0100000000010000");
  assert.equal(safeUrl("https://shop.example.com/game.nsp"), "https://shop.example.com/game.nsp");
});
