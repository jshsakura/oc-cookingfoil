import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { REPO_RE, createClientRelease, digestHex } from "../../src/meta/client-release.js";
import { inspectNro } from "../../src/meta/client-build.js";

/** A minimal NRO: header, then an ASET block whose NACP carries `version`. */
function fakeNro(version) {
  const nroSize = 0x100;
  const head = Buffer.alloc(nroSize);
  head.write("NRO0", 0x10);
  head.writeUInt32LE(nroSize, 0x18);
  const aset = Buffer.alloc(0x38);
  aset.write("ASET", 0);
  aset.writeBigUInt64LE(0x38n, 0x18);
  aset.writeBigUInt64LE(0x4000n, 0x20);
  const nacp = Buffer.alloc(0x4000);
  nacp.write("CookingFoil", 0);
  nacp.write(version, 0x3060);
  return Buffer.concat([head, aset, nacp]);
}

const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const DOWNLOAD = "https://github.example.org/client-latest/cookingfoil.nro";

/** A GitHub stand-in serving one release; counts requests and honours If-None-Match. */
function fakeGitHub({ body, digest = `sha256:${sha(body)}`, size = body.length, assetName = "cookingfoil.nro", status = 200 } = {}) {
  const calls = { api: 0, download: 0, conditional: 0 };
  const fetchImpl = async (url, opts = {}) => {
    if (url === DOWNLOAD) {
      calls.download++;
      return new Response(body);
    }
    calls.api++;
    if (status !== 200) return new Response("", { status });
    if (opts.headers?.["If-None-Match"] === '"e1"') {
      calls.conditional++;
      return new Response(null, { status: 304 });
    }
    const assets = assetName ? [{ name: assetName, size, digest, browser_download_url: DOWNLOAD }] : [];
    return new Response(JSON.stringify({ tag_name: "client-latest", assets }), { headers: { etag: '"e1"' } });
  };
  return { fetchImpl, calls };
}

/** A tracker over a temp folder whose publish() offers whatever valid build lands at dest. */
function setup(fetchImpl, { offered = null, repo = "owner/client" } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "client-release-"));
  const dest = path.join(dir, "cookingfoil.nro");
  let current = offered;
  let published = 0;
  const tracker = createClientRelease({
    repo: () => repo,
    dest,
    stateFile: path.join(dir, "release.json"),
    current: () => current,
    publish: async () => {
      published++;
      const buf = fs.readFileSync(dest);
      current = { version: inspectNro(buf).version, size: buf.length, sha256: sha(buf) };
    },
    fetchImpl,
    maxBytes: 1024 * 1024,
  });
  return { tracker, dest, dir, offered: () => current, published: () => published };
}

test("digestHex reads GitHub's sha256 digest and nothing else", () => {
  assert.equal(digestHex(`sha256:${"A".repeat(64)}`), "a".repeat(64));
  assert.equal(digestHex(`sha1:${"a".repeat(40)}`), null);
  assert.equal(digestHex(null), null);
});

test("takes a newer build from the release and publishes it whole", async () => {
  const body = fakeNro("0.3.157");
  const gh = fakeGitHub({ body });
  const t = setup(gh.fetchImpl, { offered: { version: "0.3.156", size: 1, sha256: "b".repeat(64) } });
  const s = await t.tracker.check();
  assert.equal(s.error, null);
  assert.equal(s.fetched.version, "0.3.157");
  assert.equal(t.offered().sha256, sha(body));
  assert.deepEqual(fs.readFileSync(t.dest), body);
  assert.equal(fs.existsSync(`${t.dest}.release-part`), false);
});

test("an unchanged release answers 304 and downloads nothing", async () => {
  const body = fakeNro("0.3.157");
  const gh = fakeGitHub({ body });
  const t = setup(gh.fetchImpl);
  await t.tracker.check();
  await t.tracker.check();
  assert.equal(gh.calls.conditional, 1);
  assert.equal(gh.calls.download, 1);
  assert.equal(t.published(), 1);
});

test("the build already offered is not downloaded again", async () => {
  const body = fakeNro("0.3.157");
  const gh = fakeGitHub({ body });
  const t = setup(gh.fetchImpl, { offered: { version: "0.3.157", size: body.length, sha256: sha(body) } });
  const s = await t.tracker.check();
  assert.equal(gh.calls.download, 0);
  assert.equal(s.fetched.version, "0.3.157");
});

test("bytes that don't match the release digest are not used", async () => {
  const body = fakeNro("0.3.157");
  const gh = fakeGitHub({ body, digest: `sha256:${"c".repeat(64)}` });
  const t = setup(gh.fetchImpl);
  const s = await t.tracker.check();
  assert.match(s.error.message, /sha256/);
  assert.equal(fs.existsSync(t.dest), false);
  assert.equal(t.offered(), null);
});

test("a body longer than the release says is cut off", async () => {
  const body = fakeNro("0.3.157");
  const gh = fakeGitHub({ body, size: body.length - 1 });
  const t = setup(gh.fetchImpl);
  const s = await t.tracker.check();
  assert.match(s.error.message, /larger/);
  assert.equal(fs.existsSync(t.dest), false);
});

test("a missing asset keeps the offered build and is asked for again next time", async () => {
  const body = fakeNro("0.3.157");
  const gh = fakeGitHub({ body, assetName: null });
  const offered = { version: "0.3.156", size: 1, sha256: "b".repeat(64) };
  const t = setup(gh.fetchImpl, { offered });
  const s = await t.tracker.check();
  assert.match(s.error.message, /no cookingfoil\.nro/);
  await t.tracker.check();
  assert.equal(gh.calls.conditional, 0);
  assert.equal(t.offered(), offered);
});

test("an older build than the one offered is refused", async () => {
  const body = fakeNro("0.3.100");
  const gh = fakeGitHub({ body });
  const t = setup(gh.fetchImpl, { offered: { version: "0.3.156", size: 1, sha256: "b".repeat(64) } });
  const s = await t.tracker.check();
  assert.match(s.error.message, /older/);
  assert.equal(fs.existsSync(t.dest), false);
});

test("a file that isn't a CookingFoil NRO is refused", async () => {
  const body = Buffer.from("not an nro at all");
  const gh = fakeGitHub({ body });
  const t = setup(gh.fetchImpl);
  const s = await t.tracker.check();
  assert.match(s.error.message, /not a CookingFoil build/);
  assert.equal(fs.existsSync(t.dest), false);
});

test("an empty repository follows nothing", async () => {
  const gh = fakeGitHub({ body: fakeNro("0.3.157") });
  const t = setup(gh.fetchImpl, { repo: "" });
  const s = await t.tracker.check();
  assert.equal(gh.calls.api, 0);
  assert.equal(s.repo, null);
});

test("a repository without the release reports it", async () => {
  const gh = fakeGitHub({ body: fakeNro("0.3.157"), status: 404 });
  const t = setup(gh.fetchImpl);
  const s = await t.tracker.check();
  assert.match(s.error.message, /no client-latest release/);
});

test("a refused build is not downloaded again until the release changes or a forced check", async () => {
  const body = fakeNro("0.3.100");
  const gh = fakeGitHub({ body });
  const t = setup(gh.fetchImpl, { offered: { version: "0.3.156", size: 1, sha256: "b".repeat(64) } });
  await t.tracker.check();
  const again = await t.tracker.check();
  assert.equal(gh.calls.download, 1);
  assert.match(again.error.message, /older/);
  await t.tracker.check({ force: true });
  assert.equal(gh.calls.download, 2);
});

test("an error from another repository is not shown under the current one", async () => {
  const gh = fakeGitHub({ body: fakeNro("0.3.157"), status: 404 });
  let name = "owner/old";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "client-release-"));
  const t = createClientRelease({ repo: () => name, dest: path.join(dir, "cookingfoil.nro"), stateFile: path.join(dir, "release.json"), current: () => null, publish: async () => {}, fetchImpl: gh.fetchImpl });
  assert.ok((await t.check()).error);
  name = "owner/new";
  assert.equal(t.status().error, null);
});

test("repository names can't walk out of /repos/", () => {
  assert.ok(REPO_RE.test("owner/oc-cookingfoil"));
  assert.ok(REPO_RE.test("o.wner/na.me"));
  for (const bad of ["../..", "owner/..", "./x", "owner", "a/b/c", "owner/na me"]) assert.equal(REPO_RE.test(bad), false, bad);
});
