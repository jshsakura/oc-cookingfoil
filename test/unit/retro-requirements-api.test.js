import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";

// What the library still needs, read by the admin page and by an API token alike.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "retro-req-api-"));
process.env.COOK_DATA_DIR = root;
process.env.COOK_RETRO_DIR = path.join(root, "retro");
process.env.COOK_RATING_SYNC = "false";
// No core fetching here: the view reads "missing" for a core whether the upkeep or the file check says it.
process.env.COOK_RETRO_AUTO_CORES = "false";
for (const rel of ["roms/pcecd/Game.cue", "roms/gba/Game.gba", "retroarch/cores/mgba_libretro_libnx.nro", "retroarch/system/SYSCARD3.PCE"]) {
  fs.mkdirSync(path.dirname(path.join(root, "retro", rel)), { recursive: true });
  fs.writeFileSync(path.join(root, "retro", rel), "x");
}
const { mountRetroArtApi } = await import("../../src/routes/admin/retro-art-api.js");
const retroCatalog = await import("../../src/retro/catalog.js");

test("GET /admin/api/retro/requirements names each system's core file and firmware state", async () => {
  const app = express();
  const router = express.Router();
  mountRetroArtApi(router, () => true);
  app.use("/admin", router);
  const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  try {
    await retroCatalog.scan(process.env.COOK_RETRO_DIR);
    const base = `http://127.0.0.1:${server.address().port}/admin/api`;
    const res = await fetch(`${base}/retro/requirements`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.match(body.note, /\.nro/);
    assert.equal(body.retroarch, "missing");
    assert.equal(body.complete, false);
    const pce = body.systems.find((s) => s.id === "pcecd");
    assert.deepEqual(pce.firmware.map((f) => [f.files, f.required, f.state, f.file]), [[["syscard3.pce"], true, "mismatch", "SYSCARD3.PCE"]]);
    assert.equal(pce.cores[0].file, "mednafen_pce_fast_libretro_libnx.nro");
    assert.equal(pce.cores[0].state, "missing");
    assert.equal(pce.cores[0].warn, true);
    const gba = body.systems.find((s) => s.id === "gba");
    // There: "pinned" from the upkeep (the server did not place it), "present" from the file check alone.
    assert.ok(["pinned", "present"].includes(gba.cores[0].state), gba.cores[0].state);
    assert.equal(gba.cores[0].warn, false);
    assert.deepEqual(gba.firmware.map((f) => [f.files, f.required, f.state]), [[["gba_bios.bin"], false, "missing"]]);
    assert.equal(body.systems[0].id, "pcecd", "what still needs something comes first");

    const art = await (await fetch(`${base}/retro-art`)).json();
    assert.deepEqual(art.requirements, body, "the retro tab gets the same view");
    assert.deepEqual(art.bios, [], "the old notice matches by name, any case");
  } finally {
    server.close();
  }
});
