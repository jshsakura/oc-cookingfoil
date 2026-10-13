import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";

// Deleting a retro game from the admin page takes its ROM and the disc files it names.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "retro-rm-"));
process.env.COOK_DATA_DIR = root;
process.env.COOK_RETRO_DIR = path.join(root, "retro");
process.env.COOK_RATING_SYNC = "false";
const ps1 = path.join(root, "retro", "roms", "ps1");
fs.mkdirSync(ps1, { recursive: true });
fs.writeFileSync(path.join(ps1, "Game.cue"), 'FILE "Game.bin" BINARY\n');
fs.writeFileSync(path.join(ps1, "Game.bin"), "x");
fs.writeFileSync(path.join(ps1, "Other.chd"), "x");
const { mountRetroArtApi } = await import("../../src/routes/admin/retro-art-api.js");
const retroCatalog = await import("../../src/retro/catalog.js");

test("a removed game's cue and bin go, other games stay", async () => {
  const app = express();
  app.use(express.json());
  const router = express.Router();
  mountRetroArtApi(router, () => true);
  app.use("/admin", router);
  const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  try {
    const base = `http://127.0.0.1:${server.address().port}/admin/api/retro-art`;
    const catalog = await retroCatalog.scan(process.env.COOK_RETRO_DIR);
    const game = catalog.games.find((g) => g.name === "Game");
    const post = (body) => fetch(`${base}/games/remove`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    assert.equal((await post({ game: "ps1-0000000000" })).status, 404);
    const r = await post({ game: game.id });
    assert.deepEqual(await r.json(), { ok: true, files: 2 });
    assert.deepEqual(fs.readdirSync(ps1), ["Other.chd"]);
  } finally {
    server.close();
  }
});
