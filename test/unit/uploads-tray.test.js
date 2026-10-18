import { test, after, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// The upload tray (/api/uploads): pending uploads are bounded, and applying one
// never writes through a link that sits where the game would go.
const root = fs.mkdtempSync(path.join(tmpdir(), "cook-uploads-tray-"));
const games = path.join(root, "games");
fs.mkdirSync(games);
process.env.COOK_DATA_DIR = path.join(root, "data");
process.env.COOK_GAMES_DIR = games;
process.env.COOK_UPLOADS_ENABLED = "true";
process.env.COOK_UPLOAD_MAX_BYTES = "1000";
const express = (await import("express")).default;
const { default: uploadsRouter, MAX_PENDING_UPLOADS } = await import("../../src/routes/uploads.js");

const app = express();
app.use("/api/uploads", uploadsRouter());
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/api/uploads`;
after(() => { server.close(); fs.rmSync(root, { recursive: true, force: true }); });

async function send(name, bytes) {
  const form = new FormData();
  form.append("file", new Blob([Buffer.alloc(bytes, 1)]), name);
  return fetch(base, { method: "POST", body: form });
}
const clear = async () => {
  for (const u of (await (await fetch(base)).json()).uploads) await fetch(`${base}/${u.id}`, { method: "DELETE" });
};

test("a new upload is refused once the pending ones reach the count cap", async () => {
  for (let i = 0; i < MAX_PENDING_UPLOADS; i++) assert.equal((await send(`Game ${i} [0100000000010000][v0].nsp`, 1)).status, 201);
  const over = await send("One more [0100000000020000][v0].nsp", 1);
  assert.equal(over.status, 409);
  assert.match((await over.json()).error, /pending/);
  await clear();
});

test("a new upload is refused once the pending bytes would pass the size cap", async () => {
  assert.equal((await send("Big [0100000000030000][v0].nsp", 500)).status, 201);
  assert.equal((await send("Bigger [0100000000040000][v0].nsp", 600)).status, 413);
  await clear();
});

test("applying across disks replaces a link at the target instead of writing through it", async () => {
  const outside = path.join(root, "outside.txt");
  fs.writeFileSync(outside, "keep me");
  const name = "Linked [0100000000050000][v0].nsp";
  fs.symlinkSync(outside, path.join(games, name));
  const sent = await (await send(name, 10)).json();
  const realRename = fsp.rename;
  let crossed = false;
  const renamed = mock.method(fsp, "rename", async (from, to) => {
    if (!crossed && String(from).includes(`${sent.id}__`)) {
      crossed = true;
      throw Object.assign(new Error("cross-device link not permitted"), { code: "EXDEV" });
    }
    return realRename(from, to);
  });
  try {
    const applied = await fetch(`${base}/${sent.id}/apply?force=1`, { method: "POST" });
    assert.equal(applied.status, 200);
  } finally {
    renamed.mock.restore();
  }
  assert.ok(crossed, "the cross-disk branch ran");
  assert.equal(fs.readFileSync(outside, "utf8"), "keep me", "the link's target is untouched");
  const st = fs.lstatSync(path.join(games, name));
  assert.ok(st.isFile() && !st.isSymbolicLink(), "the game is a plain file now");
  assert.equal(st.size, 10);
});
