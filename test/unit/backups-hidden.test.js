import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { makeCard, FAKE_WORK, FAKE_RIF, FAKE_DB } from "./fixtures/vita-card.js";

// Console backups live outside every folder the server shows or cleans: the file explorer, files_list, the
// trash and trash_list never see them, and a backups folder placed inside one of those turns backups off.
const root = mkdtempSync(path.join(tmpdir(), "cf-backups-hidden-"));
const games = path.join(root, "games");
const backups = path.join(root, "backups");
mkdirSync(games, { recursive: true });
mkdirSync(backups, { recursive: true });
Object.assign(process.env, {
  COOK_DATA_DIR: path.join(root, "data"), COOK_GAMES_DIR: games, COOK_BACKUPS_DIR: backups,
  COOK_AUTH_USERS: "alice:alice-password", COOK_TITLEDB_AUTO_FETCH: "false",
});
const { importUx0 } = await import("../../src/backups/import.js");
const { accountNamed } = await import("../../src/backups/account.js");
const { filesCapabilities } = await import("../../src/capabilities/files.js");
const { trashCapabilities } = await import("../../src/capabilities/trash.js");
const { FILE_ROOT_KEYS } = await import("../../src/library/file-roots.js");
after(() => rmSync(root, { recursive: true, force: true }));

const handler = (list, id) => list.find((c) => c.id === id).handler;
const LEAKS = ["work.bin", ".rif", "license.db", "PCSE00001", path.basename(backups), FAKE_WORK, FAKE_RIF, FAKE_DB];

test("files_list over every library folder and trash_list name nothing of the backups", async () => {
  await importUx0({ ux0: makeCard(path.join(root, "card")), accountId: accountNamed("alice").id });
  const seen = [];
  const walk = async (rootKey, rel, depth) => {
    const out = await handler(filesCapabilities, "files_list")({}, { root: rootKey, path: rel, perPage: 500 }).catch(() => null);
    if (!out) return;
    seen.push(JSON.stringify(out));
    if (depth < 4) for (const item of out.items.filter((i) => i.type === "dir")) await walk(rootKey, item.rel, depth + 1);
  };
  for (const key of FILE_ROOT_KEYS) await walk(key, "", 0);
  seen.push(JSON.stringify(await handler(trashCapabilities, "trash_list")({}, { limit: 200 })));
  const text = seen.join("\n");
  for (const word of LEAKS) assert.equal(text.includes(word), false, word);
});

test("a backups folder inside one of the server's folders turns backups off", () => {
  for (const inside of [path.join(games, "backups"), path.join(root, "data", "backups")]) {
    mkdirSync(inside, { recursive: true });
    const on = execFileSync(process.execPath, ["--input-type=module", "-e",
      `const { backupsRoot } = await import(${JSON.stringify(path.resolve("src/backups/store.js"))}); process.stdout.write(String(backupsRoot()));`], {
      env: { ...process.env, COOK_BACKUPS_DIR: inside }, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    });
    assert.equal(on, "null", inside);
  }
});
