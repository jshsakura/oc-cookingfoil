import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const data = fs.mkdtempSync(path.join(os.tmpdir(), "cook-clientlog-"));
process.env.COOK_DATA_DIR = data;
const log = await import("../../src/routes/client-log.js");

const put = (prefix, name, body, owner) => {
  const dir = path.join(log.LOGS_DIR, prefix);
  fs.mkdirSync(dir, { recursive: true });
  if (owner) fs.writeFileSync(path.join(dir, ".owner"), `${owner}\n`);
  if (name) fs.writeFileSync(path.join(dir, name), body);
};

test("a log counts against the account that signed in, not the device key it sends", () => {
  assert.equal(log.ownerOf({ auth: { user: "alice" } }), "user:alice");
  assert.equal(log.ownerOf({ webUser: { kind: "google", sub: "123" } }), "google:123");
  assert.equal(log.ownerOf({ pairedDevice: "ABCDEF0123456789" }), "paired:abcdef01");
});

test("an account may start only so many console folders, and there is a cap across all of them", async () => {
  for (let i = 0; i < log.MAX_CONSOLES_PER_ACCOUNT; i++) put(`aaaa000${i}`, null, null, "user:alice");
  assert.equal(await log.folderRefusal("bbbb0000", "user:alice"), "too many consoles send logs for this account");
  assert.equal(await log.folderRefusal("aaaa0001", "user:alice"), null, "an existing folder is still written");
  assert.equal(await log.folderRefusal("bbbb0000", "user:bob"), null, "other accounts have their own share");
  for (let i = 0; log.MAX_FOLDERS > log.MAX_CONSOLES_PER_ACCOUNT + i; i++) put(`ff${i.toString(16).padStart(6, "0")}`, null, null, `user:u${i}`);
  assert.equal(await log.folderRefusal("dddd0000", "user:new"), "log storage is full");
});

test("past the total size the oldest logs go first, from any console", async () => {
  fs.rmSync(log.LOGS_DIR, { recursive: true, force: true });
  put("eeee0001", "20200101-000000.txt", "x".repeat(400), "user:a");
  put("eeee0002", "20210101-000000.txt", "x".repeat(400), "user:b");
  put("eeee0002", "latest.txt", "x".repeat(100));
  await log.trimTotal(600);
  assert.equal(fs.existsSync(path.join(log.LOGS_DIR, "eeee0001", "20200101-000000.txt")), false, "the oldest went");
  assert.equal(fs.existsSync(path.join(log.LOGS_DIR, "eeee0002", "20210101-000000.txt")), true);
  assert.equal(fs.existsSync(path.join(log.LOGS_DIR, "eeee0002", "latest.txt")), true);
});
