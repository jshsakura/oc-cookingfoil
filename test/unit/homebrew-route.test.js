import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { homebrewRouter } from "../../src/routes/homebrew.js";

const ID = "gh-0123456789ab";
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function fakeService(dir) {
  const nro = path.join(dir, "ytb-player.nro");
  fs.writeFileSync(nro, "nro bytes");
  const entry = {
    id: ID, name: "YTB Player", version: "1.1.0", author: "murat303", description: null, size: 9, hash: "sha256:abc",
    file_name: "ytb-player.nro", source: "github", released_at: "2026-09-26T20:06:01Z",
    repo_url: "https://github.com/murat303/ytb-player",
  };
  return {
    list: async () => [entry],
    icon: async (id) => (id === ID ? PNG : null),
    download: async (id) => (id === ID ? { path: nro, sha256: "f00d", file_name: "ytb-player.nro" } : null),
  };
}

async function serve(service) {
  const app = express();
  app.use("/api/homebrew", homebrewRouter({ service }));
  const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  return { base: `http://127.0.0.1:${server.address().port}/api/homebrew`, close: () => server.close() };
}

test("the listing carries the icon and download addresses and answers If-None-Match", async () => {
  const { base, close } = await serve(fakeService(fs.mkdtempSync(path.join(os.tmpdir(), "hb-route-"))));
  try {
    const res = await fetch(base);
    assert.equal(res.status, 200);
    const { homebrew } = await res.json();
    assert.equal(homebrew.length, 1);
    assert.equal(homebrew[0].icon_url, `/api/homebrew/${ID}/icon`);
    assert.equal(homebrew[0].download_url, `/api/homebrew/${ID}/download`);
    assert.equal(homebrew[0].hash, "sha256:abc");
    // fetch adds "Cache-Control: no-cache" to conditional requests unless one is given; a console's curl does not.
    const again = await fetch(base, { headers: { "If-None-Match": res.headers.get("etag"), "Cache-Control": "max-age=0" } });
    assert.equal(again.status, 304);
  } finally {
    close();
  }
});

test("a download is the build itself with its sha256 as the ETag", async () => {
  const { base, close } = await serve(fakeService(fs.mkdtempSync(path.join(os.tmpdir(), "hb-route-"))));
  try {
    const res = await fetch(`${base}/${ID}/download`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("etag"), '"f00d"');
    assert.equal(res.headers.get("content-length"), "9");
    assert.match(res.headers.get("content-disposition"), /ytb-player\.nro/);
    assert.equal(await res.text(), "nro bytes");
  } finally {
    close();
  }
});

test("icons are served with their own type", async () => {
  const { base, close } = await serve(fakeService(fs.mkdtempSync(path.join(os.tmpdir(), "hb-route-"))));
  try {
    const res = await fetch(`${base}/${ID}/icon`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/png");
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), PNG);
  } finally {
    close();
  }
});

test("unknown or malformed ids are refused", async () => {
  const { base, close } = await serve(fakeService(fs.mkdtempSync(path.join(os.tmpdir(), "hb-route-"))));
  try {
    assert.equal((await fetch(`${base}/gh-ffffffffffff/download`)).status, 404);
    assert.equal((await fetch(`${base}/gh-ffffffffffff/icon`)).status, 404);
    assert.equal((await fetch(`${base}/..%2F..%2Fetc/download`)).status, 400);
  } finally {
    close();
  }
});

test("a download that cannot be fetched from GitHub answers 502", async () => {
  const service = { ...fakeService(fs.mkdtempSync(path.join(os.tmpdir(), "hb-route-"))), download: async () => { throw new Error("offline"); } };
  const { base, close } = await serve(service);
  try {
    assert.equal((await fetch(`${base}/${ID}/download`)).status, 502);
  } finally {
    close();
  }
});
