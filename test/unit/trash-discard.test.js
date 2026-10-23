import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// discard() is how anything that is not a database row is deleted: into the trash of the folder it
// is in, the server's own data folder included, and back with a restore.
const base = fs.mkdtempSync(path.join(os.tmpdir(), "cook-discard-"));
const dirs = Object.fromEntries(["games", "data", "retro"].map((k) => [k, path.join(base, k)]));
for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
process.env.COOK_GAMES_DIR = dirs.games;
process.env.COOK_DATA_DIR = dirs.data;
process.env.COOK_RETRO_DIR = dirs.retro;
after(() => fs.rmSync(base, { recursive: true, force: true }));

const service = await import("../../src/library/trash-service.js");
service._setRefresh(async () => {});
const by = { type: "admin", name: "test" };
const put = (abs, body = "x") => {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
  return abs;
};

test("discard moves files of the data and a library folder into their own trash, and restore puts them back", async () => {
  const art = put(path.join(dirs.data, "custom-art", "0100000000010000", "icon.webp"), "art");
  const game = put(path.join(dirs.games, "Game [0100000000010000][v0].nsp"), "game");
  const out = await service.discard([art, game], { kind: "art", action: "art-remove", by, name: "icon" });
  assert.equal(out.ids.length, 2);
  assert.ok(!fs.existsSync(art) && !fs.existsSync(game));

  const { items } = await service.list();
  assert.deepEqual(items.map((e) => e.root).sort(), ["data", "games"]);

  const { failed } = await service.restore(out.ids, by);
  assert.deepEqual(failed, []);
  assert.equal(fs.readFileSync(art, "utf8"), "art");
  assert.equal(fs.readFileSync(game, "utf8"), "game");
});

test("discard refuses a library folder itself, and puts back what it moved when a later folder fails", async () => {
  await assert.rejects(service.discard([dirs.retro], { by }), (err) => err.status === 400);
  assert.ok(fs.existsSync(dirs.retro));
  const game = put(path.join(dirs.games, "Kept [0100000000030000][v0].nsp"), "kept");
  const missing = path.join(dirs.data, "not-there.webp");
  await assert.rejects(service.discard([game, missing], { by }));
  assert.equal(fs.readFileSync(game, "utf8"), "kept", "the first folder's file came back");
});

test("discard refuses a path outside every folder, and moves nothing of the call", async () => {
  const inside = put(path.join(dirs.games, "Game [0100000000020000][v0].nsp"));
  const outside = put(path.join(base, "elsewhere.txt"));
  await assert.rejects(service.discard([inside, outside], { by }), (err) => err.status === 400);
  assert.ok(fs.existsSync(inside) && fs.existsSync(outside));
});

test("a secret keeps its 0600 mode in the trash and after a restore", async () => {
  const keys = put(path.join(dirs.data, "keys", "prod.keys"), "secret");
  fs.chmodSync(keys, 0o600);
  const out = await service.discard([keys], { kind: "keys", action: "keys-remove", by, name: "prod.keys" });
  const [entry] = (await service.list()).items.filter((e) => e.id === out.id);
  const inTrash = fs.readdirSync(path.join(dirs.data, ".cookingfoil-trash"), { recursive: true }).map((r) => path.join(dirs.data, ".cookingfoil-trash", r)).find((p) => path.basename(p) === "prod.keys");
  assert.equal(fs.statSync(inTrash).mode & 0o777, 0o600);
  assert.ok(!JSON.stringify(entry).includes("secret"), "the list never carries the contents");
  await service.restore([out.id], by);
  assert.equal(fs.statSync(keys).mode & 0o777, 0o600);
});
