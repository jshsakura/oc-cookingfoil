import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fromJsonSchema } from "@modelcontextprotocol/server";

// The served tools' declared outputs against real results with something in their lists: an empty
// list proves nothing about its items. mcp.test.js checks the empty server.
const base = fs.mkdtempSync(path.join(os.tmpdir(), "cook-mcp-outputs-"));
const dirs = Object.fromEntries(["games", "incoming", "patches", "saves", "homebrew", "retro", "data"].map((k) => [k, path.join(base, k)]));
for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
process.env.COOK_GAMES_DIR = dirs.games;
process.env.COOK_INCOMING_DIR = dirs.incoming;
process.env.COOK_PATCHES_DIR = dirs.patches;
process.env.COOK_SAVES_DIR = dirs.saves;
process.env.COOK_HOMEBREW_DIR = dirs.homebrew;
process.env.COOK_RETRO_DIR = dirs.retro;
process.env.COOK_DATA_DIR = dirs.data;
process.env.COOK_RATING_SYNC = "false";
process.env.COOK_TITLEDB_AUTO_FETCH = "false";

const { registry } = await import("../../src/capabilities/registry.js");
const service = await import("../../src/library/trash-service.js");

const put = (root, rel) => {
  const abs = path.join(dirs[root], rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, "x");
  return abs;
};

async function check(id, input = {}) {
  const cap = registry.byId(id);
  const out = JSON.parse(JSON.stringify(await cap.handler({}, input)));
  const { issues } = await fromJsonSchema(cap.output)["~standard"].validate(out);
  assert.equal(issues, undefined, `${id}: ${JSON.stringify(issues)}`);
  return out;
}

test("trash_list's items match its output", async () => {
  put("games", "Some Game/Some Game [0100000000010000][v0].nsp");
  await service.trash("games", [{ rel: "Some Game/Some Game [0100000000010000][v0].nsp" }], { kind: "game", action: "remove", by: { type: "admin", name: "test" }, name: "Some Game" });
  const out = await check("trash_list");
  assert.equal(out.items.length, 1);
});

test("trash_journal's moves match its output", async () => {
  const from = put("incoming", "Other [0100000000020000][v0].nsp");
  const to = path.join(dirs.games, "Other", "Other [0100000000020000][v0].nsp");
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.renameSync(from, to);
  await service.recordMove({ action: "organize", by: { type: "job", name: "incoming" }, from, to });
  const out = await check("trash_journal");
  assert.equal(out.items.length, 1);
});
