import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";

// An app the admin turned off stays on the server but clients no longer see or fetch it.
process.env.COOK_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "hb-off-"));
const disabled = await import("../../src/meta/homebrew-disabled.js");
const { homebrewRouter } = await import("../../src/routes/homebrew.js");

const ON = "gh-0123456789ab", OFF = "m-ba9876543210";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hb-off-files-"));
fs.writeFileSync(path.join(dir, "a.nro"), "nro");
const entry = (id, name) => ({ id, name, size: 3, hash: "h", file_name: `${name}.nro`, source: "github", enabled: !disabled.isDisabled(id) });
const service = {
  list: async () => [entry(ON, "kept"), entry(OFF, "hidden")],
  download: async (id) => ({ path: path.join(dir, "a.nro"), sha256: "x", file_name: `${id}.nro` }),
};

async function serve() {
  const app = express();
  app.use("/api/homebrew", homebrewRouter({ service }));
  const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  return { base: `http://127.0.0.1:${server.address().port}/api/homebrew`, close: () => server.close() };
}

test("turning an app off hides it from the list and its downloads; on again brings it back", async () => {
  const { base, close } = await serve();
  try {
    assert.equal(disabled.setEnabled(OFF, false), true);
    const listed = (await (await fetch(base)).json()).homebrew;
    assert.deepEqual(listed.map((e) => e.name), ["kept"]);
    assert.equal("enabled" in listed[0], false, "the flag itself is not sent");
    assert.equal((await fetch(`${base}/${OFF}/download`)).status, 404);
    assert.equal((await fetch(`${base}/${ON}/download`)).status, 200);
    disabled.setEnabled(OFF, true);
    assert.equal((await fetch(`${base}/${OFF}/download`)).status, 200);
    assert.equal(JSON.parse(fs.readFileSync(path.join(process.env.COOK_DATA_DIR, "homebrew", "disabled.json"), "utf8"))[OFF], undefined);
  } finally {
    close();
  }
});

test("only app ids are stored", () => {
  assert.equal(disabled.setEnabled("../x", false), false);
});
