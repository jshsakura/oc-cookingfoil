import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Editing an uploaded game patch or save from the admin page.
process.env.COOK_DATA_DIR = mkdtempSync(path.join(tmpdir(), "cook-content-"));
const { patchMeta, saveMeta, movedPatchPath } = await import("../../src/routes/admin/content-api.js");
const { readMeta, localizePatch } = await import("../../src/meta/user-patches.js");

test("a patch edit keeps required and drops emptied fields", () => {
  const next = patchMeta({ name: "old", required: true, author: "x" }, { name: " 한글패치 ", nameKo: "", description: "Korean text", descriptionKo: "한국어로 변경합니다", version: "1.2", author: "" });
  assert.deepEqual(next, { name: "한글패치", version: "1.2", description: "Korean text", ko: { description: "한국어로 변경합니다" }, required: true });
  assert.throws(() => patchMeta({}, { name: "  " }), /이름/);
});

test("a patch edit keeps the game version and the update it is for unless it sets them", () => {
  const old = { name: "오프라인 실행 패치", game_version: "1.0.32.0", update_version: 2097152, required: true };
  assert.deepEqual(patchMeta(old, { name: "오프라인 실행 패치" }),
    { name: "오프라인 실행 패치", game_version: "1.0.32.0", update_version: 2097152, required: true }, "an older page that sends neither");
  assert.deepEqual(patchMeta(old, { name: "a", gameVersion: "1.0.33.0", updateVersion: "2162688" }),
    { name: "a", game_version: "1.0.33.0", update_version: 2162688, required: true });
  assert.deepEqual(patchMeta(old, { name: "a", gameVersion: "", updateVersion: "" }), { name: "a", required: true }, "cleared");
  for (const bad of ["v2097152", "-1", "1.5", "99999999999"]) assert.throws(() => patchMeta(old, { name: "a", updateVersion: bad }), /업데이트/, bad);
});

test("a save edit checks the source address and the save kind", () => {
  assert.deepEqual(
    saveMeta({}, { name: "All karts", saveType: "device", sourceName: "Forum", sourceUrl: "https://example.org/x", gameVersion: "3.0" }),
    { name: "All karts", gameVersion: "3.0", saveType: "device", source: { name: "Forum", url: "https://example.org/x" } },
  );
  assert.equal(saveMeta({}, { name: "a", saveType: "nope" }).saveType, undefined);
  assert.throws(() => saveMeta({}, { name: "a", sourceName: "b", sourceUrl: "javascript:alert(1)" }), (err) => err.key === "content.badSource" && /http or https/.test(err.message));
});

test("a moved patch takes its game's folders along, program offsets kept", () => {
  const from = "0100AAAA00000000", to = "0100BBBB00002000";
  assert.equal(movedPatchPath("atmosphere/contents/0100AAAA00000000/romfs/a.bin", from, to), "atmosphere/contents/0100BBBB00002000/romfs/a.bin");
  assert.equal(movedPatchPath("atmosphere/contents/0100aaaa00000001/exefs/main", from, to), "atmosphere/contents/0100bbbb00002001/exefs/main");
  assert.equal(movedPatchPath("SaltySD/plugins/FPSLocker/patches/0100aaaa00000000/1.yaml", from, to), "SaltySD/plugins/FPSLocker/patches/0100bbbb00002000/1.yaml");
  assert.equal(movedPatchPath("atmosphere/exefs_patches/fix/ABCD.ips", from, to), "atmosphere/exefs_patches/fix/ABCD.ips");
  assert.equal(movedPatchPath("atmosphere/contents/0100CCCC00000000/romfs/a", from, to), "atmosphere/contents/0100CCCC00000000/romfs/a");
});

test("a patch's Korean text is shown in Korean only", () => {
  const p = { id: "x", name: "Korean patch", description: "Turns the text Korean", ...readMeta({ ko: { name: "한글패치", description: "한국어로 변경합니다" } }) };
  assert.deepEqual([localizePatch(p, "ko").name, localizePatch(p, "ko").description], ["한글패치", "한국어로 변경합니다"]);
  assert.deepEqual([localizePatch(p, "en").name, localizePatch(p, "en").ko], ["Korean patch", undefined]);
});
