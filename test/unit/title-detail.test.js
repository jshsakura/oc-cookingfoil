import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// GET /api/title/:baseTitleId surfaces the rich titledb detail (description,
// publisher, screenshots, banner) the shop response drops. Exercise the route
// handler directly against a warmed store fixture, with mock req/res, in a
// child process so COOK_DATA_DIR/module state stay isolated.

const PROBE = `
  import * as store from "../../src/meta/titledb-store.js";
  import route from "../../src/routes/title-detail.js";
  await store.load();
  const mkRes = () => {
    const r = { code: 200, body: null, headers: {} };
    r.status = (c) => { r.code = c; return r; };
    r.json = (o) => { r.body = o; return r; };
    r.header = (k, v) => { r.headers[k] = v; return r; };
    return r;
  };
  const req = (id) => ({ params: { baseTitleId: id }, get: () => undefined, protocol: "http" });
  const call = (id) => { const res = mkRes(); route(req(id), res); return res; };

  const ok = call("0100000000ABC000");
  const bad = call("ZZZZ");
  const missing = call("0100000000FFF000");
  process.stdout.write(JSON.stringify({
    okCode: ok.code, name: ok.body?.name, publisher: ok.body?.publisher,
    descLen: (ok.body?.description || "").length, shots: ok.body?.screenshotCount,
    shot0: ok.body?.screenshots?.[0], banner: ok.body?.bannerUrl,
    badCode: bad.code, missingCode: missing.code,
  }));
`;

test("title-detail: serves rich metadata, 400 on bad id, 404 when unknown", () => {
  const data = mkdtempSync(path.join(tmpdir(), "cook-detail-"));
  mkdirSync(path.join(data, "titledb"), { recursive: true });
  writeFileSync(
    path.join(data, "titledb", "US.en.json"),
    JSON.stringify({
      "70010000000001": {
        id: "0100000000ABC000",
        name: "Test Title",
        publisher: "OpenCourse",
        description: "A rich description that the shop response would drop.",
        releaseDate: 20240101,
        screenshots: ["https://cdn/a.jpg", "https://cdn/b.jpg"],
        bannerUrl: "https://cdn/banner.jpg",
      },
    })
  );

  const out = execFileSync(process.execPath, ["--input-type=module", "-e", PROBE], {
    cwd: import.meta.dirname,
    env: { ...process.env, COOK_DATA_DIR: data, COOK_EXTRACT_ICONS: "off" },
    encoding: "utf-8",
  });
  const r = JSON.parse(out);

  assert.equal(r.okCode, 200);
  assert.equal(r.name, "Test Title");
  assert.equal(r.publisher, "OpenCourse");
  assert.ok(r.descLen > 10, "description surfaced");
  assert.equal(r.shots, 2);
  // screenshots/banner point at the proxy endpoints (relative — no origin in mock req)
  assert.equal(r.shot0, "/api/shop/screenshot/0100000000ABC000/0?v=" + r.shot0.split("v=")[1]);
  assert.ok(r.banner.startsWith("/api/shop/banner/0100000000ABC000"), "banner proxied");
  assert.equal(r.badCode, 400);
  assert.equal(r.missingCode, 404);
});
