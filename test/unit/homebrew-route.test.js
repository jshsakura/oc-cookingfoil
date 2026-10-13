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

test("the listing names where each app goes and, for a folder install, every file with its own address", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hb-route-"));
  const font = path.join(dir, "font.ttf");
  fs.writeFileSync(font, "font");
  const folder = {
    ...fakeService(dir),
    list: async () => [
      { id: ID, name: "ACNH", file_name: "acnh_editor.nro", hash: "h1", install_dir: "switch/acnh_editor", install_path: "switch/acnh_editor/acnh_editor.nro",
        files: [{ path: "switch/acnh_editor/acnh_editor.nro", size: 9, sha256: "a" }, { path: "switch/acnh_editor/font.ttf", size: 4, sha256: "b" }] },
      { id: "m-0123456789ab", name: "Plain", file_name: "ftpd.nro", hash: "h2" },
    ],
    file: async (id, p) => (id === ID && p === "switch/acnh_editor/font.ttf" ? { path: font, sha256: "b", size: 4 } : null),
  };
  const { base, close } = await serve(folder);
  try {
    const { homebrew: [acnh, plain] } = await (await fetch(base)).json();
    assert.equal(acnh.install_path, "switch/acnh_editor/acnh_editor.nro");
    assert.equal(acnh.files[1].url, `/api/homebrew/${ID}/file?path=switch%2Facnh_editor%2Ffont.ttf`);
    assert.deepEqual([plain.install_path, plain.install_dir, plain.files], ["switch/ftpd/ftpd.nro", null, null]);
    const got = await fetch(`http://127.0.0.1:${new URL(base).port}${acnh.files[1].url}`);
    assert.equal(got.status, 200);
    assert.equal(await got.text(), "font");
    assert.equal((await fetch(`${base}/${ID}/file?path=switch/acnh_editor/../../etc/passwd`)).status, 404);
    assert.equal((await fetch(`${base}/${ID}/file`)).status, 404);
  } finally {
    close();
  }
});

test("a folder install also comes as one tar in listed order, resumable with If-Range", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hb-route-"));
  const nro = path.join(dir, "app.nro");
  const font = path.join(dir, "font + bold.ttf");
  fs.writeFileSync(nro, "nro bytes");
  fs.writeFileSync(font, "font");
  const files = [
    { path: "switch/acnh_editor/acnh_editor.nro", size: 9, sha256: "a", abs: nro },
    { path: "switch/acnh_editor/fonts/font + bold.ttf", size: 4, sha256: "b", abs: font },
  ];
  const service = {
    ...fakeService(dir),
    list: async () => [
      { id: ID, name: "ACNH", file_name: "acnh_editor.nro", hash: "h1", install_dir: "switch/acnh_editor", install_path: "switch/acnh_editor/acnh_editor.nro",
        files: files.map(({ abs: _a, ...f }) => f) },
      { id: "m-0123456789ab", name: "Plain", file_name: "ftpd.nro", hash: "h2" },
    ],
    bundle: async (id) => (id === ID ? files : null),
  };
  const { base, close } = await serve(service);
  try {
    const { homebrew: [acnh, plain] } = await (await fetch(base)).json();
    assert.equal(acnh.bundle_url, `/api/homebrew/${ID}/bundle`);
    assert.equal(plain.bundle_url, null);
    assert.equal((await fetch(`${base}/m-0123456789ab/bundle`)).status, 404);

    const url = `http://127.0.0.1:${new URL(base).port}${acnh.bundle_url}`;
    const res = await fetch(url);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/x-tar");
    const tar = Buffer.from(await res.arrayBuffer());
    assert.equal(Number(res.headers.get("content-length")), tar.length);
    // Folders first, then the files in listed order, each body on a 512-byte boundary.
    const names = [];
    for (let at = 0; at + 512 <= tar.length && tar[at]; ) {
      const name = tar.subarray(at, at + 100).toString().replace(/\0.*$/s, "");
      const prefix = tar.subarray(at + 345, at + 500).toString().replace(/\0.*$/s, "");
      const size = parseInt(tar.subarray(at + 124, at + 136).toString(), 8);
      names.push(prefix ? `${prefix}/${name}` : name);
      if (size) assert.equal(tar.subarray(at + 512, at + 512 + size).toString(), names.at(-1).endsWith(".nro") ? "nro bytes" : "font");
      at += 512 + Math.ceil(size / 512) * 512;
    }
    assert.deepEqual(names, ["switch/", "switch/acnh_editor/", "switch/acnh_editor/fonts/", ...files.map((f) => f.path)]);
    assert.deepEqual([...tar.subarray(tar.length - 1024)], new Array(1024).fill(0));

    // The ETag names the paths and hashes; a resume with it gets the rest.
    const etag = res.headers.get("etag");
    const again = await fetch(url);
    assert.equal(again.headers.get("etag"), etag);
    const part = await fetch(url, { headers: { Range: "bytes=1000-", "If-Range": etag } });
    assert.equal(part.status, 206);
    assert.equal(part.headers.get("content-range"), `bytes 1000-${tar.length - 1}/${tar.length}`);
    assert.deepEqual(Buffer.from(await part.arrayBuffer()), tar.subarray(1000));
    // A stale ETag gets the whole archive again.
    assert.equal((await fetch(url, { headers: { Range: "bytes=1000-", "If-Range": '"old"' } })).status, 200);
  } finally {
    close();
  }
});
