import { test } from "node:test";
import assert from "node:assert/strict";
import { patchPlan } from "../../src/meta/patch-intake.js";
import { metaErrorText } from "../../src/meta/meta-messages.js";

// A patch arrives however its author zipped it; every shape below must land as the same
// SD-root layout, so a person dropping a file and the AI registering one get one result.
const MK = "0100152000022000";
const UPD = "0100152000022800";
const C = `atmosphere/contents/${MK}`;

const placed = (plan) => Object.fromEntries(plan.files.map((f) => [f.from, f.to]));

const SHAPES = [
  ["the SD layout itself", [`${C}/romfs/a.bin`, `${C}/cheats/x.txt`], { [`${C}/romfs/a.bin`]: `${C}/romfs/a.bin`, [`${C}/cheats/x.txt`]: `${C}/cheats/x.txt` }],
  ["one wrapper folder", [`Korean Patch v1.2/${C}/romfs/a.bin`], { [`Korean Patch v1.2/${C}/romfs/a.bin`]: `${C}/romfs/a.bin` }],
  ["two wrapper folders", [`SD/한글패치/${C}/romfs/a.bin`], { [`SD/한글패치/${C}/romfs/a.bin`]: `${C}/romfs/a.bin` }],
  ["atmosphere/ left out", [`contents/${MK}/romfs/a.bin`], { [`contents/${MK}/romfs/a.bin`]: `${C}/romfs/a.bin` }],
  ["only the title folder", [`${MK}/romfs/a.bin`, `${MK}/exefs/main.npdm`], { [`${MK}/romfs/a.bin`]: `${C}/romfs/a.bin`, [`${MK}/exefs/main.npdm`]: `${C}/exefs/main.npdm` }],
  ["a lower-case title folder under capitalised names", [`Atmosphere/Contents/${MK.toLowerCase()}/RomFS/a.bin`], { [`Atmosphere/Contents/${MK.toLowerCase()}/RomFS/a.bin`]: `${C}/romfs/a.bin` }],
  ["the old SX OS titles/ folder", [`titles/${MK}/romfs/a.bin`], { [`titles/${MK}/romfs/a.bin`]: `${C}/romfs/a.bin` }],
  ["bare romfs/ and exefs/", [`romfs/a.bin`, `exefs/b.ips`], { "romfs/a.bin": `${C}/romfs/a.bin`, "exefs/b.ips": `${C}/exefs/b.ips` }],
  ["bare romfs/ under a wrapper", [`패치/romfs/a.bin`], { "패치/romfs/a.bin": `${C}/romfs/a.bin` }],
  ["exefs_patches/ at the top", [`exefs_patches/kor/x.ips`], { "exefs_patches/kor/x.ips": "atmosphere/exefs_patches/kor/x.ips" }],
  ["the update's folder", [`contents/${UPD}/romfs/a.bin`], { [`contents/${UPD}/romfs/a.bin`]: `atmosphere/contents/${UPD}/romfs/a.bin` }],
  ["an FPSLocker patch", [`SaltySD/plugins/FPSLocker/patches/${MK.toLowerCase()}/1.0.yaml`], { [`SaltySD/plugins/FPSLocker/patches/${MK.toLowerCase()}/1.0.yaml`]: `SaltySD/plugins/FPSLocker/patches/${MK.toLowerCase()}/1.0.yaml` }],
];

for (const [shape, paths, want] of SHAPES) {
  test(`a patch zipped as ${shape} lands in the SD layout`, () => {
    const plan = patchPlan(paths, MK);
    assert.deepEqual(placed(plan), want);
    assert.deepEqual(plan.dropped, []);
    assert.equal(plan.titleId, MK);
  });
}

test("macOS and Windows leftovers are dropped, not refused", () => {
  const plan = patchPlan([`P/${C}/romfs/a.bin`, `__MACOSX/P/${C}/romfs/._a.bin`, "P/.DS_Store", "P/Thumbs.db", "P/desktop.ini"], MK);
  assert.deepEqual(placed(plan), { [`P/${C}/romfs/a.bin`]: `${C}/romfs/a.bin` });
  assert.deepEqual(plan.dropped.sort(), ["P/.DS_Store", "P/Thumbs.db", "P/desktop.ini", `__MACOSX/P/${C}/romfs/._a.bin`].sort());
});

test("notes and pictures beside the patch are dropped, a cheat's .txt inside it is kept", () => {
  const plan = patchPlan(["설치방법.txt", "README.md", "shot.png", "credits.url", `${C}/cheats/0123.txt`, `${C}/romfs/a.bin`], MK);
  assert.deepEqual(Object.keys(placed(plan)).sort(), [`${C}/cheats/0123.txt`, `${C}/romfs/a.bin`]);
  assert.deepEqual(plan.dropped.sort(), ["README.md", "credits.url", "shot.png", "설치방법.txt"]);
});

test("a note inside the wrapper folder does not stop the wrapper from being peeled", () => {
  const plan = patchPlan(["Patch/readme.txt", `Patch/${C}/romfs/a.bin`], MK);
  assert.deepEqual(placed(plan), { [`Patch/${C}/romfs/a.bin`]: `${C}/romfs/a.bin` });
  assert.deepEqual(plan.dropped, ["Patch/readme.txt"]);
});

test("with no game picked, the game is read from the title folder, an update's folder naming its base game", () => {
  assert.equal(patchPlan([`${C}/romfs/a.bin`], null).titleId, MK);
  assert.equal(patchPlan([`contents/${UPD}/romfs/a.bin`], null).titleId, MK);
  assert.equal(patchPlan([`${MK.toLowerCase()}/romfs/a.bin`], undefined).titleId, MK);
});

test("a bare romfs/ with no game picked asks for the game", () => {
  assert.throws(() => patchPlan(["romfs/a.bin"], null), (err) => err.code === "upload.patchNeedsGame");
});

test("two games in one patch ask for the game, and another game's folder is refused when one is picked", () => {
  const other = "0100000000010000";
  assert.throws(() => patchPlan([`${C}/romfs/a.bin`, `atmosphere/contents/${other}/romfs/b.bin`], null), (err) => err.code === "upload.patchNeedsGame");
  assert.throws(() => patchPlan([`atmosphere/contents/${other}/romfs/b.bin`], MK), (err) => err.code === "upload.notPatchPath"
    && /패치 경로가 아닙니다/.test(metaErrorText("ko", err)));
});

test("an archive of only notes is refused as holding no patch", () => {
  assert.throws(() => patchPlan(["readme.txt", "__MACOSX/._readme.txt"], MK), (err) => err.code === "upload.noPatchFiles"
    && metaErrorText("ko", err) !== err.code);
});

test("a path that leaves the folder or a file the server writes itself is refused", () => {
  assert.throws(() => patchPlan([`${C}/romfs/../../x`], MK), (err) => err.code === "upload.notPatchPath");
  assert.throws(() => patchPlan([`${C}/romfs/a.bin`, "patch.json"], MK), (err) => err.code === "upload.patchJsonInside");
});
