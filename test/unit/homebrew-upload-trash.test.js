import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// An upload that replaces an app sends the old folder to the trash whole, and
// before anything takes its place: when the trash cannot take it, the upload is
// refused and the old folder stays where it was. Nothing of it is left in the
// upload's work folder, which is deleted after every upload.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "cf-hb-up-trash-"));
const dirs = Object.fromEntries(["data", "games", "homebrew", "patches", "saves", "incoming", "retro"].map((d) => [d, path.join(root, d)]));
for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
process.env.COOK_DATA_DIR = dirs.data;
process.env.COOK_GAMES_DIR = dirs.games;
process.env.COOK_HOMEBREW_DIR = dirs.homebrew;
process.env.COOK_PATCHES_DIR = dirs.patches;
process.env.COOK_SAVES_DIR = dirs.saves;
process.env.COOK_INCOMING_DIR = dirs.incoming;
process.env.COOK_RETRO_DIR = dirs.retro;
after(() => fs.rmSync(root, { recursive: true, force: true }));

const { placeHomebrew } = await import("../../src/routes/admin/homebrew-upload.js");
const trash = await import("../../src/library/trash.js");

function fakeNro(name) {
  const head = Buffer.alloc(0x100);
  head.write("NRO0", 0x10);
  head.writeUInt32LE(0x100, 0x18);
  const aset = Buffer.alloc(0x38);
  aset.write("ASET", 0);
  aset.writeBigUInt64LE(0x38n, 0x18);
  aset.writeBigUInt64LE(0x4000n, 0x20);
  const nacp = Buffer.alloc(0x4000);
  nacp.write(name, 0);
  nacp.write("1.0.0", 0x3060);
  return Buffer.concat([head, aset, nacp]);
}

/** An upload of switch/<app>/ files: [{ abs, rel }] in a fresh work folder. */
function upload(app, files) {
  const work = fs.mkdtempSync(path.join(root, "work-"));
  const items = Object.entries(files).map(([rel, body], i) => {
    const abs = path.join(work, "in", `f${i}`);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
    return { abs, rel: `switch/${app}/${rel}` };
  });
  return { work, items };
}
const put = (rel, body) => {
  fs.mkdirSync(path.dirname(path.join(dirs.homebrew, rel)), { recursive: true });
  fs.writeFileSync(path.join(dirs.homebrew, rel), body);
};

test("the replaced app goes to the trash whole, pictures included, and the pictures also move into the new build", async () => {
  put("whole/whole.nro", fakeNro("Whole"));
  put("whole/data.bin", "OLD");
  put("whole/metadata/banner.webp", "PIC");
  const { work, items } = upload("whole", { "whole.nro": fakeNro("Whole"), "data.bin": "NEW" });
  await placeHomebrew(items, work);
  fs.rmSync(work, { recursive: true, force: true });
  assert.equal(fs.readFileSync(path.join(dirs.homebrew, "whole/data.bin"), "utf8"), "NEW");
  assert.equal(fs.readFileSync(path.join(dirs.homebrew, "whole/metadata/banner.webp"), "utf8"), "PIC");
  const [entry] = await trash.listRoot({ key: "homebrew", dir: dirs.homebrew });
  assert.equal(entry.action, "homebrew-replace");
  const kept = path.join(dirs.homebrew, ".cookingfoil-trash", entry.entry, "whole");
  assert.equal(fs.readFileSync(path.join(kept, "data.bin"), "utf8"), "OLD");
  assert.equal(fs.readFileSync(path.join(kept, "metadata/banner.webp"), "utf8"), "PIC", "the trash keeps the folder as it was");
});

test("when the trash cannot take the old app the upload is refused and the old app stays", async () => {
  put("stays/stays.nro", fakeNro("Stays"));
  put("stays/data.bin", "OLD");
  // A trash that cannot be made: a file where its folder would go.
  const tr = path.join(dirs.homebrew, ".cookingfoil-trash");
  const moved = `${tr}-aside`;
  fs.renameSync(tr, moved);
  fs.writeFileSync(tr, "not a folder");
  try {
    const { work, items } = upload("stays", { "stays.nro": fakeNro("Stays"), "data.bin": "NEW" });
    await assert.rejects(placeHomebrew(items, work), /휴지통/);
    fs.rmSync(work, { recursive: true, force: true });
    assert.equal(fs.readFileSync(path.join(dirs.homebrew, "stays/data.bin"), "utf8"), "OLD");
  } finally {
    fs.rmSync(tr, { force: true });
    fs.renameSync(moved, tr);
  }
});
