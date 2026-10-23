import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

// A game with patches in the patches folder says so on its sections item, so the
// web page and the console draw a 패치 (or 필수 패치) chip without asking per card.

const WITH = "0100000000020000";
const REQUIRED = "0100000000030000";
const WITHOUT = "0100000000040000";
const cheat = (tid) => `atmosphere/contents/${tid}/cheats/ABCDEF0123456789.txt`;

const PROBE = `
  import * as userPatches from "../../src/meta/user-patches.js";
  import * as patchInfo from "../../src/meta/patch-info.js";
  import { composeSections } from "../../src/create-index-content.js";
  await userPatches.scan({ root: process.env.PATCH_ROOT });
  const req = (await userPatches.list()).find((p) => p.title_id === "${REQUIRED}");
  patchInfo.set(userPatches.locate(req.id).key, { ...userPatches.infoOf(req.id), required: true });
  const file = (tid) => ["Game [" + tid + "][v0].nsp", { url: "../" + tid + ".nsp", name: "Game [" + tid + "][v0]", size: 1 }];
  const body = composeSections(new Map([file("${WITH}"), file("${REQUIRED}"), file("${WITHOUT}")]), []);
  process.stdout.write(JSON.stringify(body));
`;

function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sections-patches-"));
  for (const [tid, folder] of [[WITH, "cheats"], [WITH, "fps"], [REQUIRED, "fix"]]) {
    const file = path.join(root, tid, folder, cheat(tid));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, folder);
  }
  try {
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", PROBE], {
      cwd: import.meta.dirname,
      env: { ...process.env, COOK_EXTRACT_ICONS: "off", COOK_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "sections-patches-data-")), PATCH_ROOT: root },
      encoding: "utf-8",
    });
    return JSON.parse(out);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("a game's sections item counts its patches and says whether one is required", () => {
  const body = run();
  const byId = new Map(body.sections[0].items.map((i) => [i.title_id, i]));
  const plain = byId.get(WITH), required = byId.get(REQUIRED), bare = byId.get(WITHOUT);

  assert.equal(plain.patches, 2);
  assert.equal(plain.patch_required, false);
  assert.deepEqual(plain.labels, ["patch"]);

  assert.equal(required.patches, 1);
  assert.equal(required.patch_required, true);
  assert.equal(required.required_patches, 1, "the older count stays for clients that read it");
  assert.deepEqual(required.labels, ["required-patch"], "a required patch shows once, in the stronger label");

  assert.equal("patches" in bare, false);
  assert.equal("patch_required" in bare, false);
  assert.equal(bare.labels, undefined);

  assert.equal(body.labels.patch.ko, "패치");
  assert.equal(body.labels.patch.en, "Mod");
  assert.equal(body.labels["required-patch"].en, "Required mod");
});
