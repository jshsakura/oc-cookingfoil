import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";

// The console's firmware routes (routes/firmware.js) over a follower whose GitHub is a stub.
process.env.COOK_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "cook-fw-route-data-"));
const { firmwareRouter } = await import("../../src/routes/firmware.js");
const { createFirmware } = await import("../../src/firmware/service.js");
const { zipStore } = await import("../../src/helpers/zip-store.js");

const zipOf = (count) => zipStore(Array.from({ length: count }, (_, i) => ({ name: `${String(i).padStart(32, "0")}.nca`, data: Buffer.alloc(64, i + 1) })), new Date(2026, 0, 1));
const BODIES = { "2.0.0": zipOf(3), "1.0.0": zipOf(2) };

/** A GitHub with two releases; `gone` versions drop out of its list, `hold` keeps downloads waiting until released. */
function stubGitHub() {
  const gh = { gone: new Set(), hold: null };
  gh.fetchImpl = async (url, init = {}) => {
    if (url.startsWith("https://api.github.com/")) {
      const releases = Object.entries(BODIES).filter(([v]) => !gh.gone.has(v)).map(([v, body], i) => ({
        tag_name: v, published_at: "2026-10-01T00:00:00Z",
        assets: [{ id: i + 1, name: `${v}.zip`, size: body.length, browser_download_url: `https://example.com/fw/${v}.zip`, state: "uploaded" }],
      }));
      return new Response(JSON.stringify(new URL(url).searchParams.get("page") === "1" ? releases : []), { status: 200 });
    }
    const body = BODIES[/\/([\d.]+)\.zip$/.exec(url)[1]];
    const range = init.headers?.Range;
    if (range) {
      const [, s, e] = /^bytes=(\d+)-(\d+)$/.exec(range).map(Number);
      return new Response(body.subarray(s, e + 1), { status: 206, headers: { "content-range": `bytes ${s}-${e}/${body.length}` } });
    }
    if (gh.hold) await gh.hold;
    return new Response(body, { status: 200 });
  };
  return gh;
}

async function serve({ repo = "example/fw-releases", keep = "latest", free = 1e15 } = {}) {
  const gh = stubGitHub();
  const t = { repo, free, gh };
  t.svc = createFirmware({ dir: fs.mkdtempSync(path.join(os.tmpdir(), "cook-fw-route-")), repo: () => t.repo, keep: () => keep, fetchImpl: gh.fetchImpl, freeBytes: async () => t.free });
  const app = express();
  app.use("/api/firmware", firmwareRouter({ service: t.svc }));
  const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  t.base = `http://127.0.0.1:${server.address().port}/api/firmware`;
  t.close = () => server.close();
  return t;
}

test("with no source set the firmware routes answer 404 firmware_off", async () => {
  const t = await serve({ repo: "" });
  try {
    for (const p of ["", "/1.0.0/download"]) {
      const res = await fetch(t.base + p);
      assert.equal(res.status, 404, p);
      assert.equal((await res.json()).code, "firmware_off", p);
    }
  } finally {
    t.close();
  }
});

test("the list answers If-None-Match with 304", async () => {
  const t = await serve();
  try {
    await t.svc.refresh();
    await t.svc.idle();
    const res = await fetch(t.base);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.versions.map((v) => v.version), ["2.0.0", "1.0.0"]);
    const etag = res.headers.get("etag");
    assert.ok(etag);
    // fetch adds "Cache-Control: no-cache" to conditional requests unless one is given; a console's curl does not.
    assert.equal((await fetch(t.base, { headers: { "If-None-Match": etag, "Cache-Control": "max-age=0" } })).status, 304);
  } finally {
    t.close();
  }
});

test("a version not held yet answers 503 with Retry-After while the server fetches it, then serves it with Range and its sha256 as ETag", async () => {
  const t = await serve();
  try {
    await t.svc.refresh();
    await t.svc.idle();
    let release;
    t.gh.hold = new Promise((resolve) => { release = resolve; });
    const waiting = await fetch(`${t.base}/1.0.0/download`);
    assert.equal(waiting.status, 503);
    assert.equal(waiting.headers.get("retry-after"), "30");
    assert.equal((await waiting.json()).code, "caching");
    assert.equal((await fetch(`${t.base}/1.0.0/download`)).status, 503, "still fetching: asked again, still 503");
    release();
    await t.svc.idle();

    const body = BODIES["1.0.0"];
    const etag = `"${crypto.createHash("sha256").update(body).digest("hex")}"`;
    const whole = await fetch(`${t.base}/1.0.0/download`);
    assert.equal(whole.status, 200);
    assert.equal(whole.headers.get("etag"), etag);
    assert.equal(whole.headers.get("content-length"), String(body.length));
    assert.ok(Buffer.from(await whole.arrayBuffer()).equals(body));

    const tail = await fetch(`${t.base}/1.0.0/download`, { headers: { Range: "bytes=-22" } });
    assert.equal(tail.status, 206);
    assert.equal(tail.headers.get("content-range"), `bytes ${body.length - 22}-${body.length - 1}/${body.length}`);
    assert.equal(tail.headers.get("content-length"), "22");
    assert.ok(Buffer.from(await tail.arrayBuffer()).equals(body.subarray(-22)));

    const resumed = await fetch(`${t.base}/1.0.0/download`, { headers: { Range: "bytes=10-", "If-Range": etag } });
    assert.equal(resumed.status, 206);
    assert.equal((await fetch(`${t.base}/1.0.0/download`, { headers: { Range: "bytes=10-", "If-Range": '"another"' } })).status, 200, "another file: the whole of it");
    assert.equal((await fetch(`${t.base}/1.0.0/download`, { headers: { "If-None-Match": etag, "Cache-Control": "max-age=0" } })).status, 304);
    assert.equal((await t.svc.list()).versions.find((v) => v.version === "1.0.0").archive.sha256, etag.slice(1, -1));
  } finally {
    t.close();
  }
});

test("unknown and malformed versions are 404, unavailable ones 410 with the reason, and no room is 507", async () => {
  const t = await serve();
  try {
    await t.svc.refresh();
    await t.svc.idle();
    for (const v of ["9.9.9", "1.0", "..", "1.0.0.zip", "%2e%2e%2f1.0.0"]) {
      const res = await fetch(`${t.base}/${v}/download`);
      assert.equal(res.status, 404, v);
      if (res.headers.get("content-type")?.includes("json")) assert.equal((await res.json()).code, "unknown_version", v);
    }
    t.gh.gone.add("1.0.0");
    await t.svc.refresh();
    const gone = await fetch(`${t.base}/1.0.0/download`);
    assert.equal(gone.status, 410);
    assert.deepEqual(await gone.json(), { error: "this firmware cannot be downloaded", code: "unavailable", reason: "upstream_gone" });
    assert.equal((await fetch(`${t.base}/2.0.0/download`)).status, 200, "the cached newest is still served");

    const short = await serve({ free: 1 });
    try {
      await short.svc.refresh();
      const res = await fetch(`${short.base}/1.0.0/download`);
      assert.equal(res.status, 507);
      assert.equal((await res.json()).code, "no_space");
    } finally {
      short.close();
    }
  } finally {
    t.close();
  }
});
