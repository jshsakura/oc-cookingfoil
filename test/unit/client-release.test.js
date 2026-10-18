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
const DOWNLOAD = "https://github.example.org/v0.3.157/cookingfoil.nro";

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
    return new Response(JSON.stringify({ tag_name: "v0.3.157", assets }), { headers: { etag: '"e1"' } });
  };
  return { fetchImpl, calls };
}

/** A tracker over a temp folder; `have` is a build already fetched to dest, and publish() counts the choices. */
function setup(fetchImpl, { have = null, repo = "owner/client", tag = "", asset = "cookingfoil.nro" } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "client-release-"));
  const dest = path.join(dir, "github", "cookingfoil.nro");
  if (have) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, have);
  }
  let published = 0;
  const tracker = createClientRelease({
    repo: () => repo,
    tag: () => tag,
    asset: () => asset,
    dest,
    stateFile: path.join(dir, "github", "release.json"),
    current: () => {
      if (!fs.existsSync(dest)) return null;
      const buf = fs.readFileSync(dest);
      return { version: inspectNro(buf).version, size: buf.length, sha256: sha(buf) };
    },
    publish: async () => {
      published++;
    },
    fetchImpl,
    maxBytes: 1024 * 1024,
  });
  return { tracker, dest, dir, published: () => published };
}

test("digestHex reads GitHub's sha256 digest and nothing else", () => {
  assert.equal(digestHex(`sha256:${"A".repeat(64)}`), "a".repeat(64));
  assert.equal(digestHex(`sha1:${"a".repeat(40)}`), null);
  assert.equal(digestHex(null), null);
});

test("takes a newer build from the release and publishes it whole", async () => {
  const body = fakeNro("0.3.157");
  const gh = fakeGitHub({ body });
  const t = setup(gh.fetchImpl, { have: fakeNro("0.3.156") });
  const s = await t.tracker.check();
  assert.equal(s.error, null);
  assert.equal(s.fetched.version, "0.3.157");
  assert.equal(t.published(), 1, "the offered build is chosen again");
  assert.deepEqual(fs.readFileSync(t.dest), body);
  assert.equal(fs.existsSync(`${t.dest}.part`), false);
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

test("the build already fetched is not downloaded again", async () => {
  const body = fakeNro("0.3.157");
  const gh = fakeGitHub({ body });
  const t = setup(gh.fetchImpl, { have: body });
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
  assert.equal(t.published(), 0);
});

test("a body longer than the release says is cut off", async () => {
  const body = fakeNro("0.3.157");
  const gh = fakeGitHub({ body, size: body.length - 1 });
  const t = setup(gh.fetchImpl);
  const s = await t.tracker.check();
  assert.match(s.error.message, /larger/);
  assert.equal(fs.existsSync(t.dest), false);
});

test("a missing asset keeps the fetched build and is asked for again next time", async () => {
  const body = fakeNro("0.3.157");
  const gh = fakeGitHub({ body, assetName: null });
  const have = fakeNro("0.3.156");
  const t = setup(gh.fetchImpl, { have });
  const s = await t.tracker.check();
  assert.match(s.error.message, /no cookingfoil\.nro/);
  await t.tracker.check();
  assert.equal(gh.calls.conditional, 0);
  assert.deepEqual(fs.readFileSync(t.dest), have);
});

test("an older build than the one fetched before is refused", async () => {
  const body = fakeNro("0.3.100");
  const gh = fakeGitHub({ body });
  const have = fakeNro("0.3.156");
  const t = setup(gh.fetchImpl, { have });
  const s = await t.tracker.check();
  assert.match(s.error.message, /older/);
  assert.deepEqual(fs.readFileSync(t.dest), have);
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
  assert.match((await setup(gh.fetchImpl).tracker.check()).error.message, /owner\/client has no published release/);
  assert.match((await setup(gh.fetchImpl, { tag: "nightly" }).tracker.check()).error.message, /no nightly release/);
});

test("with no tag set the repository's latest release is followed", async () => {
  const urls = [];
  const gh = fakeGitHub({ body: fakeNro("0.3.157") });
  const t = setup(async (url, opts) => (urls.push(url), gh.fetchImpl(url, opts)));
  const s = await t.tracker.check();
  assert.equal(s.error, null);
  assert.equal(urls[0], "https://api.github.com/repos/owner/client/releases/latest");
  assert.equal(s.fetched.version, "0.3.157", "the version is the build's own");
  assert.equal(s.tag, "");
});

test("GitHub down or failing leaves the build already fetched as it is", async () => {
  const have = fakeNro("0.3.156");
  for (const fetchImpl of [fakeGitHub({ body: fakeNro("0.3.157"), status: 502 }).fetchImpl, async () => { throw new TypeError("fetch failed"); }]) {
    const t = setup(fetchImpl, { have });
    const s = await t.tracker.check();
    assert.ok(s.error, "the failure is reported");
    assert.deepEqual(fs.readFileSync(t.dest), have);
    assert.equal(t.published(), 0, "nothing new to offer");
  }
});

test("a refused build is not downloaded again until the release changes or a forced check", async () => {
  const body = fakeNro("0.3.100");
  const gh = fakeGitHub({ body });
  const t = setup(gh.fetchImpl, { have: fakeNro("0.3.156") });
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

test("the tag and asset name are the ones set", async () => {
  const body = fakeNro("0.3.157");
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    if (url === DOWNLOAD) return new Response(body);
    return new Response(JSON.stringify({ assets: [{ name: "client-nx.nro", size: body.length, digest: `sha256:${sha(body)}`, browser_download_url: DOWNLOAD }] }), { headers: { etag: '"e"' } });
  };
  const t = setup(fetchImpl, { tag: "nightly", asset: "client-nx.nro" });
  const s = await t.tracker.check();
  assert.equal(s.error, null);
  assert.ok(urls[0].endsWith("/repos/owner/client/releases/tags/nightly"));
  assert.equal(s.tag, "nightly");
  assert.equal(s.asset, "client-nx.nro");
});

test("a tag or asset name that doesn't fit is refused before asking", async () => {
  const gh = fakeGitHub({ body: fakeNro("0.3.157") });
  assert.match((await setup(gh.fetchImpl, { tag: "../x" }).tracker.check()).error.message, /not a release tag/);
  assert.match((await setup(gh.fetchImpl, { asset: "x.zip" }).tracker.check()).error.message, /not an \.nro/);
  assert.equal(gh.calls.api, 0);
});

test("pickBuild offers the newer build, and the manual one on a tie", async () => {
  const { pickBuild } = await import("../../src/routes/client-update.js");
  const m = (version) => ({ version, source: "manual" });
  const g = (version) => ({ version, source: "github" });
  assert.equal(pickBuild([m("0.3.1"), g("0.3.2")]).source, "github");
  assert.equal(pickBuild([m("0.3.2"), g("0.3.2")]).source, "manual");
  assert.equal(pickBuild([g("0.3.2"), m("0.3.2")]).source, "manual");
  assert.equal(pickBuild([m("0.3.10"), g("0.3.9")]).source, "manual");
  assert.equal(pickBuild([null, g("0.1.0")]).source, "github");
  assert.equal(pickBuild([null, null]), null);
});
