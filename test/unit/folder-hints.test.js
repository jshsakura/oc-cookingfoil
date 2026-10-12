import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { oldRetroLeftBehind } from "../../src/helpers/folder-hints.js";

test("points at data/retro only when it has files and the retro folder in use is empty", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "folder-hints-"));
  const data = path.join(root, "data");
  const retro = path.join(root, "retro");
  fs.mkdirSync(retro, { recursive: true });
  assert.equal(oldRetroLeftBehind(data, retro), null, "no data/retro at all");

  fs.mkdirSync(path.join(data, "retro", "snes"), { recursive: true });
  assert.equal(oldRetroLeftBehind(data, retro), path.join(data, "retro"));

  fs.mkdirSync(path.join(retro, "snes"));
  assert.equal(oldRetroLeftBehind(data, retro), null, "already moved");
  assert.equal(oldRetroLeftBehind(data, path.join(data, "retro")), null, "still the folder in use");
  fs.rmSync(root, { recursive: true, force: true });
});
