import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { heldManual, manualNspIcon, safeNspName, scanManual, useNspReader } from "../../src/meta/homebrew.js";
import { homebrewRouter } from "../../src/routes/homebrew.js";

// Hand-placed apps built as installable titles (.nsp, like nx.js apps): listed as
// titles to install, never copied to sdmc:/switch/, with no HOME menu shortcut.
const TID = "053F13457F6B0000";
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

function folderWith(root, folder, file, bytes = "nsp bytes") {
  fs.mkdirSync(path.join(root, folder), { recursive: true });
  fs.writeFileSync(path.join(root, folder, file), bytes);
}

test("an .nsp folder is listed as a title to install, with what its control NCA says", async () => {
  const root = tmp("hb-nsp-");
  folderWith(root, "tvswiki", "TVSWIKI-v1.0.9.nsp");
  let reads = 0;
  useNspReader(async () => { reads++; return { titleId: TID, metaType: 0x80, name: "TVSWIKI", publisher: "Maker", version: "1.0.9", iconBuffer: PNG }; });
  const [e] = await scanManual(root);
  assert.equal(e.install_type, "title");
  assert.equal(e.title_id, TID);
  assert.equal(e.install_path, null);
  assert.equal(e.file_name, "TVSWIKI-v1.0.9.nsp", "the .nsp keeps its name and extension");
  assert.deepEqual([e.name, e.author, e.version, e.size], ["TVSWIKI", "Maker", "1.0.9", 9]);
  assert.match(e.sha256, /^[0-9a-f]{64}$/);
  assert.equal(await manualNspIcon(e.path), PNG);
  await scanManual(root);
  assert.equal(reads, 1, "an unchanged file is not read again");
});

test("without nstool the title id may come from the file name", async () => {
  const root = tmp("hb-nsp-");
  folderWith(root, "app", `My App [${TID.toLowerCase()}][v0].nsp`);
  useNspReader(async () => null);
  const [e] = await scanManual(root);
  assert.equal(e.title_id, TID);
  assert.equal(e.name, "app", "the folder name stands in for the NACP name");
  assert.equal(e.file_name, "app.nsp", "a name with spaces is made plain");
});

test("a file name's id is trusted only for a base title when the cnmt cannot be read", async () => {
  const root = tmp("hb-nsp-");
  folderWith(root, "upd", `Game [0100000000010800][v65536].nsp`);
  useNspReader(async () => null);
  assert.deepEqual(await scanManual(root), []);
  assert.match(Object.fromEntries(heldManual().map((h) => [h.folder, h.reason])).upd, /타이틀 ID/);
});

test("a failed read is tried again later, not kept until the file changes", async () => {
  const root = tmp("hb-nsp-");
  folderWith(root, "flaky", "flaky.nsp");
  let calls = 0;
  useNspReader(async () => (++calls === 1 ? null : { titleId: TID, metaType: 0x80, name: "Flaky" }));
  assert.deepEqual(await scanManual(root), []);
  assert.deepEqual(await scanManual(root), [], "within the retry window it is not read again");
  assert.equal(calls, 1);
  const realNow = Date.now;
  Date.now = () => realNow() + 11 * 60_000;
  try {
    assert.deepEqual((await scanManual(root)).map((e) => e.name), ["Flaky"]);
  } finally {
    Date.now = realNow;
  }
});

test("an .nsp whose title id cannot be read, or an update, is held back with the reason", async () => {
  const root = tmp("hb-nsp-");
  folderWith(root, "unknown", "unknown.nsp");
  folderWith(root, "update", "update.nsp");
  useNspReader(async (abs) => (abs.includes("update") ? { titleId: "053F13457F6B0800", metaType: 0x81 } : null));
  assert.deepEqual(await scanManual(root), []);
  const held = Object.fromEntries(heldManual().map((h) => [h.folder, h.reason]));
  assert.match(held.unknown, /타이틀 ID/);
  assert.match(held.update, /게임 폴더/);
});

test("an .nro next to an .nsp still wins: the folder stays a card install", async () => {
  const root = tmp("hb-nsp-");
  folderWith(root, "both", "both.nsp");
  fs.writeFileSync(path.join(root, "both", "both.nro"), "not an nro");
  useNspReader(async () => ({ titleId: TID, metaType: 0x80 }));
  assert.deepEqual(await scanManual(root), [], "the broken .nro is reported, the .nsp is not used instead");
});

test("plain .nsp names stay, anything else becomes <folder>.nsp", () => {
  assert.equal(safeNspName("TVSWIKI-v1.0.9.nsp", "x"), "TVSWIKI-v1.0.9.nsp");
  assert.equal(safeNspName("../boot.nsp", "tvswiki"), "tvswiki.nsp");
  assert.equal(safeNspName("앱.nsp", "앱"), "app.nsp");
});

function service(dir) {
  const nsp = path.join(dir, "TVSWIKI-v1.0.9.nsp");
  fs.writeFileSync(nsp, "nsp bytes");
  const title = { id: "m-0123456789ab", name: "TVSWIKI", version: "1.0.9", author: "Maker", size: 9, hash: "f00d", file_name: "TVSWIKI-v1.0.9.nsp",
    source: "manual", released_at: "2026-10-16T00:00:00Z", repo_url: null, install_type: "title", title_id: TID, install_path: null };
  const nro = { id: "m-ba9876543210", name: "Tool", version: "1.0", author: "A", size: 3, hash: "beef", file_name: "tool.nro",
    source: "manual", released_at: "2026-10-16T00:00:00Z", repo_url: null };
  return {
    list: async () => [title, nro],
    icon: async () => PNG,
    download: async (id) => (id === title.id ? { path: nsp, sha256: "f00d", file_name: title.file_name } : null),
    forwarderInfo: () => ({ forwarder_url: "/should-not-appear", forwarder_title_id: "0500000000000000", forwarder_size: 1 }),
  };
}

async function serve(svc) {
  const app = express();
  app.use("/api/homebrew", homebrewRouter({ service: svc }));
  const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  return { base: `http://127.0.0.1:${server.address().port}/api/homebrew`, close: () => server.close() };
}

test("titles are listed only to a client that asks, as titles to install with no shortcut", async () => {
  const { base, close } = await serve(service(tmp("hb-nsp-route-")));
  try {
    const plain = (await (await fetch(base)).json()).homebrew;
    assert.deepEqual(plain.map((e) => e.name), ["Tool"], "an older client never sees the .nsp");
    assert.equal(plain[0].install_type, "file");
    assert.equal(plain[0].title_id, null);

    const all = (await (await fetch(`${base}?with=titles`)).json()).homebrew;
    const t = all.find((e) => e.install_type === "title");
    assert.equal(t.title_id, TID);
    assert.equal(t.install_path, null);
    assert.equal(t.app, null);
    assert.equal(t.files, null);
    assert.equal(t.archive, null);
    assert.equal(t.forwarder_url, null, "an installed title is its own HOME menu entry");
    assert.equal(t.download_url, "/api/homebrew/m-0123456789ab/download");
    assert.equal(all.length, 2);

    const dl = await fetch(`${base}/m-0123456789ab/download`, { headers: { Range: "bytes=0-2" } });
    // The test service gives no key, so the replaced-file check has nothing to compare and lets it through.
    assert.equal(dl.status, 206);
    assert.match(dl.headers.get("content-disposition"), /TVSWIKI-v1\.0\.9\.nsp/);
  } finally {
    close();
  }
});
