import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { CoreError, removeCore } from "../../src/retro/core-files.js";

const retro = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "retro-core-files-"));
  fs.mkdirSync(path.join(dir, "retroarch/cores"), { recursive: true });
  fs.writeFileSync(path.join(dir, "retroarch/cores/fceumm_libretro_libnx.nro"), "x");
  return dir;
};

test("a core games use is removed only when forced", async () => {
  const dir = retro();
  const games = [{ core: "fceumm" }, { core: "fceumm" }, { core: "mgba" }];
  await assert.rejects(removeCore(dir, "fceumm", games), (err) => err instanceof CoreError && err.status === 409 && err.extra.using === 2);
  assert.ok(fs.existsSync(path.join(dir, "retroarch/cores/fceumm_libretro_libnx.nro")));
  const out = await removeCore(dir, "fceumm", games, { force: true });
  assert.equal(out.using, 2);
  assert.deepEqual(out.files, ["retroarch/cores/fceumm_libretro_libnx.nro"]);
  assert.ok(fs.existsSync(path.join(dir, ".cookingfoil-trash", out.entry, "retroarch/cores/fceumm_libretro_libnx.nro")));
});

test("a name that is not a core, or a core that is not there, is refused", async () => {
  const dir = retro();
  await assert.rejects(removeCore(dir, "../x", []), (err) => err.status === 400);
  await assert.rejects(removeCore(dir, "mgba", []), (err) => err.status === 404);
});
