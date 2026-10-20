import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readOrCreate } from "../../src/security/server-id.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test("the server id is made once and then kept", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "server-id-")), "nested", "server-id");
  const id = readOrCreate(file);
  assert.match(id, UUID_RE);
  assert.equal(readOrCreate(file), id, "the next start reads the same one");
  assert.equal(fs.readFileSync(file, "utf8"), `${id}\n`);
  assert.ok(!fs.existsSync(`${file}.tmp`));
});

test("a malformed server id file is replaced with a new id", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "server-id-")), "server-id");
  fs.writeFileSync(file, "not-an-id\n");
  const id = readOrCreate(file);
  assert.match(id, UUID_RE);
  assert.equal(readOrCreate(file), id);
});
