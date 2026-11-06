import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { zipStore } from "../../src/helpers/zip-store.js";
import { directoryAt } from "../../src/helpers/zip-read.js";
import { firmwareProblem } from "../../src/firmware/archive.js";
import { compareVersions, newestFirst, slimRelease, upstreamVersions } from "../../src/firmware/versions.js";
import { createFirmware } from "../../src/firmware/service.js";

// Firmware releases followed from a GitHub repository (src/firmware). GitHub, the disk's free
// space and the clock are injected: nothing here reaches the network.

const REPO = "example/fw-releases";
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "cook-fw-"));
const nca = (i) => `${i.toString(16).padStart(32, "0")}.nca`;

/** A stored firmware zip of `count` small .nca files; `names` replaces the names. */
function fwZip(count, { names = null, bytes = 10 } = {}) {
  const list = names ?? Array.from({ length: count }, (_, i) => nca(i));
  return zipStore(list.map((name, i) => ({ name, data: Buffer.alloc(bytes, i + 1) })), new Date(2026, 0, 1));
}

/**
 * A fake GitHub: releases newest first, each with one zip asset. An asset may answer range reads
 * (the zip's tail) from other bytes than a full download, or fail them (`tail: "fail"`).
 * `down` makes the API fail: "network", a status number, or "empty".
 */
function fakeGitHub() {
  const gh = { releases: [], assets: new Map(), down: null, calls: [] };
  gh.add = (version, body, { tail = body, tag = version } = {}) => {
    const url = `https://example.com/fw/${tag}.zip`;
    gh.assets.set(url, { body, tail });
    gh.releases.push({ tag_name: tag, draft: false, published_at: "2026-10-01T08:00:00Z", assets: [{ id: gh.releases.length + 1, name: `Firmware.${tag}.zip`, size: body.length, browser_download_url: url, state: "uploaded" }] });
    return url;
  };
  gh.remove = (version) => { gh.releases = gh.releases.filter((r) => r.tag_name !== version); };
  gh.fetchImpl = async (url, init = {}) => {
    gh.calls.push(url);
    if (url.startsWith("https://api.github.com/")) {
      if (gh.down === "network") throw new TypeError("fetch failed");
      if (typeof gh.down === "number") return new Response("{}", { status: gh.down });
      const u = new URL(url);
      const per = Number(u.searchParams.get("per_page"));
      const page = Number(u.searchParams.get("page"));
      const body = JSON.stringify(gh.down === "empty" ? [] : gh.releases.slice((page - 1) * per, page * per));
      const etag = `"${sha256(Buffer.from(body)).slice(0, 16)}"`;
      if (init.headers?.["If-None-Match"] === etag) return new Response(null, { status: 304 });
      return new Response(body, { status: 200, headers: { etag } });
    }
    const asset = gh.assets.get(url);
    if (!asset) return new Response("", { status: 404 });
    const range = init.headers?.Range;
    if (range) {
      if (asset.tail === "fail") return new Response("", { status: 500 });
      const [, s, e] = /^bytes=(\d+)-(\d+)$/.exec(range).map(Number);
      return new Response(asset.tail.subarray(s, e + 1), { status: 206, headers: { "content-range": `bytes ${s}-${e}/${asset.tail.length}` } });
    }
    return new Response(asset.body, { status: 200 });
  };
  gh.downloads = (url) => gh.calls.filter((c) => c === url).length;
  return gh;
}

function setup({ dir = tmp(), gh = fakeGitHub(), keep = "latest", free = 1e15 } = {}) {
  const t = { dir, gh, repo: REPO, keep, free, clock: Date.UTC(2026, 10, 6) };
  t.svc = createFirmware({ dir, repo: () => t.repo, keep: () => t.keep, fetchImpl: gh.fetchImpl, now: () => t.clock, freeBytes: async () => t.free });
  t.check = async () => {
    await t.svc.refresh();
    await t.svc.idle();
  };
  t.byVersion = () => Object.fromEntries(t.svc.list().versions.map((v) => [v.version, v]));
  return t;
}

test("only plain three-number tags are firmware versions; drafts and releases without a zip are left out", () => {
  const rel = (tag, extra = {}) => slimRelease({ tag_name: tag, published_at: "2026-01-02T00:00:00Z", assets: [{ id: 1, name: `${tag}.zip`, size: 5, browser_download_url: "https://example.com/a.zip" }], ...extra });
  const releases = [rel("1.0.0"), rel("1.0.0pr"), rel("v2.0.0"), rel("2.0"), rel("10.0.0"), rel("3.0.0", { draft: true }), slimRelease({ tag_name: "4.0.0", assets: [{ id: 2, name: "notes.txt", size: 5, browser_download_url: "https://example.com/n.txt" }] })];
  const got = upstreamVersions(releases);
  assert.deepEqual([...got.keys()], ["1.0.0", "10.0.0"]);
  assert.equal(got.get("1.0.0").released, "2026-01-02");
});

test("versions sort by number, newest first: 9.0.0 comes before 10.0.0 only when ascending", () => {
  assert.ok(compareVersions("9.0.0", "10.0.0") < 0);
  assert.ok(compareVersions("1.2.10", "1.2.9") > 0);
  assert.deepEqual(newestFirst(["9.0.0", "1.2.9", "10.0.0", "1.2.10"]), ["10.0.0", "9.0.0", "1.2.10", "1.2.9"]);
});

test("a firmware zip holds only stored .nca files at its root; anything that could leave the folder refuses it", () => {
  const entries = (name) => [{ name, size: 1, compressed: 1, method: 0, flags: 0, crc32: "0" }];
  assert.equal(firmwareProblem(entries("a.nca")), null);
  for (const bad of ["d/a.nca", "/a.nca", "..a.nca", "a\\b.nca", "c:a.nca", "a.ncz", "a.nca/"]) assert.ok(firmwareProblem(entries(bad)), bad);
  assert.ok(firmwareProblem([]), "an empty zip");
  assert.ok(firmwareProblem([{ ...entries("a.nca")[0], method: 8 }]), "a compressed entry");
  assert.ok(firmwareProblem([...entries("a.nca"), ...entries("A.nca")]), "the same name twice");
  assert.match(firmwareProblem([...entries("a.nca"), ...entries("b.nca")], { files: 3 }), /2 files, the list says 3/);
});

test("a zip64 end record is refused instead of read", () => {
  const zip = fwZip(1);
  const tail = Buffer.from(zip);
  tail.writeUInt16LE(0xffff, tail.length - 22 + 10);
  assert.deepEqual(directoryAt(tail, tail.length), { zip64: true });
  assert.ok(directoryAt(zip, zip.length).count === 1);
});

test("the list reads every release, newest first, with numbers from each zip's tail and our own addresses", async () => {
  const t = setup();
  const bodies = { "9.0.0": fwZip(3), "10.0.0": fwZip(4), "10.0.1": fwZip(5) };
  for (const v of ["10.0.1", "10.0.0", "9.0.0"]) t.gh.add(v, bodies[v]);
  t.gh.add("1.0.0pr", fwZip(1));
  await t.check();
  const list = t.svc.list();
  assert.deepEqual(list.source, { name: REPO, reachable: true, checked_at: "2026-11-06T00:00:00Z" });
  assert.deepEqual(list.versions.map((v) => v.version), ["10.0.1", "10.0.0", "9.0.0"]);
  const old = list.versions[2];
  assert.deepEqual(old, { version: "9.0.0", released: "2026-10-01", available: true, archive: { url: "/api/firmware/9.0.0/download", size: bodies["9.0.0"].length, sha256: "", files: 3, unpacked: 30 } });
  // keep "latest": the newest is fetched ahead, and its sha256 shows once it is held.
  assert.equal(list.versions[0].archive.sha256, sha256(bodies["10.0.1"]));
  assert.equal(list.versions[1].archive.sha256, "");
  assert.ok(fs.existsSync(path.join(t.dir, "cache", "10.0.1.zip")));
});

test("keep all fetches every version, one after another", async () => {
  const t = setup({ keep: "all" });
  for (const v of ["3.0.0", "2.0.0", "1.0.0"]) t.gh.add(v, fwZip(2));
  await t.check();
  assert.ok(t.svc.list().versions.every((v) => v.archive.sha256.length === 64));
});

test("the list never shrinks when GitHub fails: network, 403, 429, 404, an empty answer or a much shorter one", async () => {
  const kinds = { network: "network", 403: "rate_limited", 429: "rate_limited", 404: "not_found", empty: "empty", shrunk: "shrunk" };
  for (const down of ["network", 403, 429, 404, "empty", "shrunk"]) {
    const t = setup();
    for (const v of ["4.0.0", "3.0.0", "2.0.0", "1.0.0"]) t.gh.add(v, fwZip(2));
    await t.check();
    const before = t.svc.list().versions;
    if (down === "shrunk") for (const v of ["4.0.0", "3.0.0", "2.0.0"]) t.gh.remove(v);
    else t.gh.down = down;
    t.clock += 3_600_000;
    await t.check();
    const after = t.svc.list();
    if (down === 404) {
      // A source that is gone keeps every version listed, but what the cache lacks can not be had any more.
      assert.deepEqual(after.versions.map((v) => v.version), before.map((v) => v.version), "404: the versions stay");
      assert.deepEqual(after.versions.map((v) => [v.version, v.available, v.reason ?? null]), [["4.0.0", true, null], ["3.0.0", false, "upstream_gone"], ["2.0.0", false, "upstream_gone"], ["1.0.0", false, "upstream_gone"]], "404: only the cached one is available");
    } else assert.deepEqual(after.versions, before, `${down}: the versions stay`);
    assert.equal(after.source.reachable, false, `${down}: the source shows as unreachable`);
    assert.equal(after.source.checked_at, "2026-11-06T01:00:00Z", `${down}: the check time moves`);
    assert.equal(t.svc.status().error.kind, kinds[down], `${down}: the failure is told apart`);
  }
});

test("a version gone upstream stays: available while its zip is cached, else upstream_gone", async () => {
  const t = setup();
  for (const v of ["4.0.0", "3.0.0", "2.0.0", "1.0.0"]) t.gh.add(v, fwZip(2));
  await t.check();
  t.gh.remove("4.0.0"); // the cached newest
  t.gh.remove("2.0.0"); // never fetched
  await t.check();
  const v = t.byVersion();
  assert.equal(v["4.0.0"].available, true);
  assert.equal(v["4.0.0"].archive.sha256.length, 64);
  assert.equal(v["2.0.0"].available, false);
  assert.equal(v["2.0.0"].reason, "upstream_gone");
  assert.equal(v["3.0.0"].available, true);
  assert.deepEqual(await t.svc.prepare("2.0.0"), { state: "unavailable", reason: "upstream_gone" });
  assert.equal((await t.svc.prepare("4.0.0")).state, "ready");
});

test("a zip deleted upstream after the list was read is upstream_gone at its first try, and comes back with the source", async () => {
  const t = setup();
  for (const v of ["2.0.0", "1.0.0"]) t.gh.add(v, fwZip(2));
  await t.check();
  t.gh.assets.delete("https://example.com/fw/1.0.0.zip");
  assert.equal((await t.svc.prepare("1.0.0")).state, "caching");
  await t.svc.idle();
  assert.deepEqual(await t.svc.prepare("1.0.0"), { state: "unavailable", reason: "upstream_gone" });
  t.gh.down = 451;
  await t.check();
  assert.equal(t.svc.status().error.kind, "not_found", "a taken-down repository is gone, not busy");
  t.gh.down = null;
  t.gh.add("1.0.0", fwZip(2));
  t.gh.releases.splice(1, 1);
  await t.check();
  assert.equal(t.byVersion()["1.0.0"].available, true, "listed again, it is available again");
});

test("bad zips are deleted, marked bad_archive, never served, and tried again only after the next check", async () => {
  const good = fwZip(2, { bytes: 10 });
  // One entry whose name and data make the zip exactly as long as the good one.
  const fewer = fwZip(1, { names: ["aa.nca"], bytes: 108 + (good.length - 218) });
  const cases = {
    subfolder: { body: fwZip(2, { names: ["d/a.nca", "dbb.nca"] }), tail: "fail", why: /"d\/a\.nca" is not an \.nca file at the zip's root/ },
    dotdot: { body: fwZip(2, { names: ["..a.nca", "bbb.nca"] }), tail: "fail", why: /"\.\.a\.nca" is not/ },
    "not nca": { body: fwZip(2, { names: ["aaa.ncb", "bbb.nca"] }), tail: "fail", why: /"aaa\.ncb" is not/ },
    "count mismatch": { body: fewer, tail: good, why: /holds 1 files, the list says 2/ },
  };
  assert.equal(fewer.length, good.length);
  for (const [what, { body, tail, why }] of Object.entries(cases)) {
    const t = setup();
    t.gh.add("2.0.0", fwZip(2));
    const url = t.gh.add("1.0.0", body, { tail });
    await t.check();
    assert.equal((await t.svc.prepare("1.0.0")).state, "caching", what);
    await t.svc.idle();
    assert.deepEqual(await t.svc.prepare("1.0.0"), { state: "unavailable", reason: "bad_archive" }, what);
    assert.equal(t.byVersion()["1.0.0"].reason, "bad_archive", what);
    assert.match(t.svc.status().versions.find((v) => v.version === "1.0.0").problem, why, what);
    assert.deepEqual(fs.readdirSync(path.join(t.dir, "cache")).filter((f) => f.startsWith("1.0.0")), [], `${what}: nothing kept`);
    const fetched = t.gh.downloads(url);
    await t.svc.prepare("1.0.0");
    await t.svc.idle();
    assert.equal(t.gh.downloads(url), fetched, `${what}: a request does not fetch it again`);
    await t.check();
    assert.equal(t.byVersion()["1.0.0"].available, true, `${what}: the next check clears the mark`);
  }
});

test("a zip whose tail already shows a subfolder is bad_archive without being downloaded", async () => {
  const t = setup();
  t.gh.add("2.0.0", fwZip(2));
  const url = t.gh.add("1.0.0", fwZip(2, { names: ["d/a.nca", "b.nca"] }));
  await t.check();
  assert.equal(t.byVersion()["1.0.0"].reason, "bad_archive");
  assert.equal(t.gh.calls.filter((c) => c === url).length, 1, "one range read, no download");
  assert.match(t.svc.status().versions.find((v) => v.version === "1.0.0").problem, /"d\/a\.nca"/);
});

test("a download waits for room: short of space it is refused, and nothing is fetched", async () => {
  const t = setup({ free: 10 });
  const url = t.gh.add("1.0.0", fwZip(2));
  await t.check();
  assert.equal((await t.svc.prepare("1.0.0")).state, "no_space");
  assert.equal(t.svc.status().failed[0].kind, "no_space", "the prefetch was refused too");
  assert.equal(t.gh.calls.filter((c) => c === url).length, 1, "only the tail was read");
});

test("the list and the cache survive a restart, and the zips are served with GitHub gone", async () => {
  const dir = tmp();
  const t = setup({ dir });
  for (const v of ["2.0.0", "1.0.0"]) t.gh.add(v, fwZip(2));
  await t.check();
  const before = t.svc.list();
  const dead = fakeGitHub();
  dead.down = "network";
  const again = setup({ dir, gh: dead });
  assert.deepEqual(again.svc.list(), before);
  const ready = await again.svc.prepare("2.0.0");
  assert.equal(ready.state, "ready");
  assert.equal(ready.sha256, before.versions[0].archive.sha256);
  await again.check();
  assert.deepEqual(again.svc.list().versions, before.versions);
  assert.equal(again.svc.list().source.reachable, false);
});

test("changing the source keeps the cached zips and drops what the old one listed but never fetched", async () => {
  const t = setup();
  for (const v of ["2.0.0", "1.0.0"]) t.gh.add(v, fwZip(2));
  await t.check();
  const other = fakeGitHub();
  other.add("3.0.0", fwZip(3));
  t.repo = "example/other-fw";
  const moved = setup({ dir: t.dir, gh: other });
  moved.repo = "example/other-fw";
  await moved.check();
  const v = moved.byVersion();
  assert.deepEqual(Object.keys(v), ["3.0.0", "2.0.0"]);
  assert.equal(v["2.0.0"].available, true, "the cached zip stays");
  assert.equal(moved.svc.list().source.name, "example/other-fw");
});

test("with the list file lost, a zip left in the cache is checked and kept, a bad one deleted, a half-written one removed", async () => {
  const dir = tmp();
  const t = setup({ dir });
  for (const v of ["2.0.0", "1.0.0"]) t.gh.add(v, fwZip(2));
  await t.check();
  const sha = t.byVersion()["2.0.0"].archive.sha256;
  fs.rmSync(path.join(dir, "state.json"));
  fs.writeFileSync(path.join(dir, "cache", "1.0.0.zip"), fwZip(2, { names: ["d/a.nca", "b.nca"] }));
  fs.writeFileSync(path.join(dir, "cache", "3.0.0.zip.part"), "half");
  const again = setup({ dir, gh: t.gh });
  await again.check();
  assert.equal(again.byVersion()["2.0.0"].archive.sha256, sha);
  assert.deepEqual(fs.readdirSync(path.join(dir, "cache")).sort(), ["2.0.0.zip"]);
});
