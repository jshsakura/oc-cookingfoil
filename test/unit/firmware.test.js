import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compareVersions, newestFirst, slimRelease, upstreamVersions } from "../../src/firmware/versions.js";
import { digestHex } from "../../src/firmware/view.js";
import { createFirmware } from "../../src/firmware/service.js";

// Firmware releases followed from a GitHub repository (src/firmware). GitHub and the clock are
// injected: nothing here reaches the network, and the server never touches a zip.

const REPO = "example/fw-releases";
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "cook-fw-"));

/** A fake GitHub: releases newest first, each with one zip asset. `down` makes the API fail: "network", a status number, or "empty". */
function fakeGitHub() {
  const gh = { releases: [], down: null, calls: [] };
  gh.add = (version, { size = 1000, digest = null, tag = version } = {}) => {
    const url = `https://example.com/fw/${tag}.zip`;
    gh.releases.push({ tag_name: tag, draft: false, published_at: "2026-10-01T08:00:00Z", assets: [{ id: gh.releases.length + 1, name: `Firmware.${tag}.zip`, size, browser_download_url: url, digest, state: "uploaded" }] });
    return url;
  };
  gh.remove = (version) => { gh.releases = gh.releases.filter((r) => r.tag_name !== version); };
  gh.fetchImpl = async (url, init = {}) => {
    gh.calls.push(url);
    if (!url.startsWith("https://api.github.com/")) throw new Error(`the server must not fetch ${url}`);
    if (gh.down === "network") throw new TypeError("fetch failed");
    if (typeof gh.down === "number") return new Response("{}", { status: gh.down });
    const u = new URL(url);
    const per = Number(u.searchParams.get("per_page"));
    const page = Number(u.searchParams.get("page"));
    const body = JSON.stringify(gh.down === "empty" ? [] : gh.releases.slice((page - 1) * per, page * per));
    const etag = `"${sha256(Buffer.from(body)).slice(0, 16)}"`;
    if (init.headers?.["If-None-Match"] === etag) return new Response(null, { status: 304 });
    return new Response(body, { status: 200, headers: { etag } });
  };
  return gh;
}

function setup({ dir = tmp(), gh = fakeGitHub() } = {}) {
  const t = { dir, gh, repo: REPO, clock: Date.UTC(2026, 10, 6) };
  t.svc = createFirmware({ dir, repo: () => t.repo, fetchImpl: gh.fetchImpl, now: () => t.clock });
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

test("a GitHub asset digest gives the sha256; anything else gives none", () => {
  const hex = "a".repeat(64);
  assert.equal(digestHex(`sha256:${hex.toUpperCase()}`), hex);
  assert.equal(digestHex("md5:abc"), "");
  assert.equal(digestHex(null), "");
});

test("the list relays every release, newest first, with each zip's own address and digest; no file is fetched or kept", async () => {
  const t = setup();
  const hex = "b".repeat(64);
  const urls = { "10.0.1": t.gh.add("10.0.1", { size: 300, digest: `sha256:${hex}` }), "10.0.0": t.gh.add("10.0.0", { size: 200 }), "9.0.0": t.gh.add("9.0.0", { size: 100 }) };
  t.gh.add("1.0.0pr");
  await t.check();
  const list = t.svc.list();
  assert.deepEqual(list.source, { name: REPO, reachable: true, checked_at: "2026-11-06T00:00:00Z" });
  assert.deepEqual(list.versions.map((v) => v.version), ["10.0.1", "10.0.0", "9.0.0"]);
  assert.deepEqual(list.versions[2], { version: "9.0.0", released: "2026-10-01", available: true, archive: { url: urls["9.0.0"], size: 100, sha256: "", files: 0, unpacked: 0 } });
  assert.equal(list.versions[0].archive.sha256, hex);
  assert.equal(list.versions[0].archive.url, urls["10.0.1"]);
  assert.ok(t.gh.calls.every((u) => u.startsWith("https://api.github.com/")), "only the release list is asked");
  assert.deepEqual(fs.readdirSync(t.dir), ["state.json"], "the list is all the server keeps");
  const st = t.svc.status();
  assert.equal(st.enabled, true);
  assert.deepEqual(st.versions[2], { version: "9.0.0", released: "2026-10-01", available: true, reason: null, size: 100, url: urls["9.0.0"] });
  assert.ok(!("cache" in st) && !("fetching" in st) && !("keep" in st));
});

test("the list never shrinks when GitHub fails: network, 403, 429, 404, an empty answer or a much shorter one", async () => {
  const t = setup();
  for (const v of ["5.0.0", "4.0.0", "3.0.0", "2.0.0", "1.0.0"]) t.gh.add(v);
  await t.check();
  const kept = t.svc.list().versions;
  for (const down of ["network", 403, 429, "empty"]) {
    t.gh.down = down;
    t.clock += 1000;
    await t.check();
    assert.deepEqual(t.svc.list().versions, kept, String(down));
    assert.equal(t.svc.list().source.reachable, false, String(down));
    assert.equal(t.svc.status().error.kind, down === "network" ? "network" : down === "empty" ? "empty" : "rate_limited", String(down));
  }
  // A source gone (404): the versions it listed read as gone upstream, but the list stays.
  t.gh.down = 404;
  await t.check();
  assert.deepEqual(t.svc.list().versions.map((v) => v.version), kept.map((v) => v.version));
  assert.ok(t.svc.list().versions.every((v) => v.available === false && v.reason === "upstream_gone"));
  // A much shorter list is not believed either.
  t.gh.down = null;
  await t.check();
  assert.ok(t.svc.list().versions.every((v) => v.available));
  for (const v of ["5.0.0", "4.0.0", "3.0.0"]) t.gh.remove(v);
  await t.check();
  assert.equal(t.svc.status().error.kind, "shrunk");
  assert.ok(t.svc.list().versions.every((v) => v.available), "the kept list is untouched");
});

test("a version gone upstream stays as upstream_gone, and comes back when the source lists it again", async () => {
  const t = setup();
  for (const v of ["2.0.0", "1.0.0"]) t.gh.add(v);
  await t.check();
  t.gh.remove("1.0.0");
  t.gh.add("3.0.0");
  await t.check();
  const by = t.byVersion();
  assert.deepEqual(Object.keys(by), ["3.0.0", "2.0.0", "1.0.0"]);
  assert.equal(by["1.0.0"].available, false);
  assert.equal(by["1.0.0"].reason, "upstream_gone");
  assert.equal(by["1.0.0"].archive.url, "https://example.com/fw/1.0.0.zip", "its last known address stays");
  t.gh.add("1.0.0");
  await t.check();
  assert.equal(t.byVersion()["1.0.0"].available, true);
  assert.equal(t.byVersion()["1.0.0"].reason, undefined);
});

test("the list survives a restart with GitHub gone", async () => {
  const dir = tmp();
  const t = setup({ dir });
  for (const v of ["2.0.0", "1.0.0"]) t.gh.add(v);
  await t.check();
  const before = t.svc.list();
  const dead = fakeGitHub();
  dead.down = "network";
  const again = setup({ dir, gh: dead });
  assert.deepEqual(again.svc.list(), before);
  await again.check();
  assert.deepEqual(again.svc.list().versions, before.versions);
  assert.equal(again.svc.list().source.reachable, false);
});

test("changing the source drops what the old one listed: another repository is another list", async () => {
  const t = setup();
  for (const v of ["2.0.0", "1.0.0"]) t.gh.add(v);
  await t.check();
  t.repo = "example/other-fw";
  assert.equal(t.svc.list().source.reachable, false, "the new source has not been asked yet");
  t.gh.releases = [];
  t.gh.add("7.0.0");
  await t.check();
  assert.deepEqual(t.svc.list().versions.map((v) => v.version), ["7.0.0"]);
  assert.equal(t.svc.list().source.name, "example/other-fw");
});

test("zips an older build cached are removed at start; a console is never served one", async () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, "cache"), { recursive: true });
  fs.writeFileSync(path.join(dir, "cache", "1.0.0.zip"), "old");
  fs.writeFileSync(path.join(dir, "cache", "2.0.0.zip.part"), "half");
  const t = setup({ dir });
  t.svc.start({ delayMs: 60_000 });
  t.svc.stop();
  assert.ok(!fs.existsSync(path.join(dir, "cache")));
  assert.equal(t.svc.tidy(), false, "nothing left to remove");
  const idle = setup({ dir: tmp() });
  idle.repo = "";
  assert.equal(idle.svc.enabled(), false);
  assert.equal(idle.svc.refreshNow(), false);
  assert.deepEqual(idle.svc.list().versions, []);
});
