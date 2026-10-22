import { mock, test } from "node:test";
import fsp from "fs/promises";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { CoreError, placeCore, removeCore } from "../../src/retro/core-files.js";
import { claimFill } from "../../src/retro/pack-fill.js";

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

const NRO = (tag) => Buffer.concat([Buffer.alloc(0x10), Buffer.from("NRO0"), Buffer.from(tag)]);
const upload = (dir, bytes) => {
  const abs = path.join(dir, "upload.nro");
  fs.writeFileSync(abs, bytes);
  return abs;
};
const CORE = "retroarch/cores/fceumm_libretro_libnx.nro";

test("an upload waits for no one: while a core job or a pack fill holds the pack it is refused and nothing moves", async () => {
  const dir = retro();
  const abs = upload(dir, NRO("mine"));
  const release = claimFill();
  try {
    await assert.rejects(placeCore(dir, { abs, name: "fceumm_libretro_libnx.nro" }, { replace: true }), (err) => err instanceof CoreError && err.status === 409 && err.extra.reason === "busy");
    await assert.rejects(placeCore(dir, { abs, name: "mgba_libretro_libnx.nro" }), (err) => err.status === 409);
  } finally { release(); }
  assert.equal(fs.readFileSync(path.join(dir, CORE), "utf8"), "x", "the core in place is untouched");
  assert.ok(fs.existsSync(abs), "the upload is still there");
  assert.equal(fs.existsSync(path.join(dir, ".trash")), false, "nothing went to the trash");
  const out = await placeCore(dir, { abs, name: "fceumm_libretro_libnx.nro" }, { replace: true });
  assert.ok(out.trashed);
  assert.deepEqual(fs.readFileSync(path.join(dir, CORE)), NRO("mine"));
  const again = claimFill();
  assert.notEqual(again, null, "the pack is free again");
  again();
});

test("an upload never overwrites a file that got to the place first", async () => {
  const dir = retro();
  fs.rmSync(path.join(dir, CORE));
  const abs = upload(dir, NRO("mine"));
  const theirs = NRO("theirs");
  const real = fsp.link;
  const m = mock.method(fsp, "link", async (from, to) => {
    if (to.endsWith("fceumm_libretro_libnx.nro")) fs.writeFileSync(to, theirs);
    return real(from, to);
  });
  try {
    await assert.rejects(placeCore(dir, { abs, name: "fceumm_libretro_libnx.nro" }), (err) => err.status === 409 && !err.extra.reason);
  } finally { m.mock.restore(); }
  assert.deepEqual(fs.readFileSync(path.join(dir, CORE)), theirs);
  assert.ok(fs.existsSync(abs), "the upload is not lost");
});
