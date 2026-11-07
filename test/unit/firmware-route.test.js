import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";

// The console's firmware list route (routes/firmware.js) over a follower whose GitHub is a stub.
process.env.COOK_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "cook-fw-route-data-"));
const { firmwareRouter } = await import("../../src/routes/firmware.js");
const { createFirmware } = await import("../../src/firmware/service.js");

const SIZES = { "2.0.0": 3000, "1.0.0": 2000 };

/** A GitHub with two releases; `gone` versions drop out of its list. An asset address is never fetched by the server. */
function stubGitHub() {
  const gh = { gone: new Set(), assetCalls: 0 };
  gh.fetchImpl = async (url) => {
    if (!url.startsWith("https://api.github.com/")) {
      gh.assetCalls++;
      throw new Error(`the server must not fetch ${url}`);
    }
    const releases = Object.entries(SIZES).filter(([v]) => !gh.gone.has(v)).map(([v, size], i) => ({
      tag_name: v, published_at: "2026-10-01T00:00:00Z",
      assets: [{ id: i + 1, name: `${v}.zip`, size, browser_download_url: `https://example.com/fw/${v}.zip`, state: "uploaded" }],
    }));
    return new Response(JSON.stringify(new URL(url).searchParams.get("page") === "1" ? releases : []), { status: 200 });
  };
  return gh;
}

async function serve({ repo = "example/fw-releases" } = {}) {
  const gh = stubGitHub();
  const t = { repo, gh };
  t.svc = createFirmware({ dir: fs.mkdtempSync(path.join(os.tmpdir(), "cook-fw-route-")), repo: () => t.repo, fetchImpl: gh.fetchImpl });
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

test("the list names each zip's address at the source and answers If-None-Match with 304", async () => {
  const t = await serve();
  try {
    await t.svc.refresh();
    await t.svc.idle();
    const res = await fetch(t.base);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.versions.map((v) => v.version), ["2.0.0", "1.0.0"]);
    assert.deepEqual(body.versions[0].archive, { url: "https://example.com/fw/2.0.0.zip", size: 3000, sha256: "", files: 0, unpacked: 0 });
    const etag = res.headers.get("etag");
    assert.ok(etag);
    // fetch adds "Cache-Control: no-cache" to conditional requests unless one is given; a console's curl does not.
    assert.equal((await fetch(t.base, { headers: { "If-None-Match": etag, "Cache-Control": "max-age=0" } })).status, 304);
    // A version the source dropped is listed as gone; nothing is fetched to stand in for it.
    t.gh.gone.add("1.0.0");
    await t.svc.refresh();
    const after = await (await fetch(t.base)).json();
    assert.deepEqual(after.versions.map((v) => [v.version, v.available, v.reason ?? null]), [["2.0.0", true, null], ["1.0.0", false, "upstream_gone"]]);
    assert.equal(t.gh.assetCalls, 0);
  } finally {
    t.close();
  }
});

test("the server serves no firmware file: the old download address is not a route", async () => {
  const t = await serve();
  try {
    await t.svc.refresh();
    assert.equal((await fetch(`${t.base}/2.0.0/download`)).status, 404);
    assert.equal((await fetch(`${t.base}/2.0.0`)).status, 404);
  } finally {
    t.close();
  }
});
