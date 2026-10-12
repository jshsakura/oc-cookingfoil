import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseRepo, pickAsset, safeFileName, scanManual, createTracker } from "../../src/meta/homebrew.js";

/** A minimal NRO whose NACP carries a name, an author and a version. */
function fakeNro(name, version, author = "someone") {
  const nroSize = 0x100;
  const head = Buffer.alloc(nroSize);
  head.write("NRO0", 0x10);
  head.writeUInt32LE(nroSize, 0x18);
  const aset = Buffer.alloc(0x38);
  aset.write("ASET", 0);
  aset.writeBigUInt64LE(0x38n, 0x18);
  aset.writeBigUInt64LE(0x4000n, 0x20);
  const nacp = Buffer.alloc(0x4000);
  nacp.write(name, 0);
  nacp.write(author, 0x200);
  nacp.write(version, 0x3060);
  return Buffer.concat([head, aset, nacp]);
}

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

/** A fake GitHub: one repo whose latest release can be swapped, recording every request. */
function fakeGitHub(repo) {
  const state = { release: null, etag: '"r1"', calls: [], nextAssetId: 100 };
  const fetchImpl = async (url, opts = {}) => {
    const headers = opts.headers ?? {};
    state.calls.push({ url, headers });
    if (url === `https://api.github.com/repos/${repo}/releases/latest`) {
      if (headers["If-None-Match"] === state.etag) return new Response(null, { status: 304 });
      return new Response(JSON.stringify(state.release.json), { status: 200, headers: { ETag: state.etag } });
    }
    const asset = state.release?.files[url];
    return asset ? new Response(asset, { status: 200 }) : new Response("nope", { status: 404 });
  };
  const publish = (tag, nro, { digest = true, etag } = {}) => {
    const url = `https://github.com/${repo}/releases/download/${tag}/ytb-player.nro`;
    state.etag = etag ?? `"${tag}"`;
    state.release = {
      files: { [url]: nro },
      json: {
        tag_name: tag,
        published_at: "2026-09-26T20:06:01Z",
        html_url: `https://github.com/${repo}/releases/tag/${tag}`,
        assets: [
          { id: 2, name: "SHA256SUMS.txt", size: 10, browser_download_url: `${url}.sums` },
          { id: state.nextAssetId++, name: "ytb-player.nro", size: nro.length, browser_download_url: url,
            digest: digest ? `sha256:${sha256(nro)}` : null, updated_at: "2026-09-26T20:06:01Z" },
        ],
      },
    };
  };
  const downloads = () => state.calls.filter((c) => c.url.startsWith("https://github.com/")).length;
  const apiCalls = () => state.calls.filter((c) => c.url.startsWith("https://api.github.com/"));
  return { state, fetchImpl, publish, downloads, apiCalls };
}

test("repositories are accepted as owner/name or as a GitHub address", () => {
  assert.equal(parseRepo("murat303/ytb-player"), "murat303/ytb-player");
  assert.equal(parseRepo(" https://github.com/murat303/ytb-player/releases "), "murat303/ytb-player");
  assert.equal(parseRepo("github.com/murat303/ytb-player.git"), "murat303/ytb-player");
  assert.equal(parseRepo("https://gitlab.com/a/b"), null);
  assert.equal(parseRepo("../etc/passwd"), null);
  assert.equal(parseRepo(""), null);
});

test("the .nro asset is picked, preferring one named after the repository", () => {
  const nro = (name) => ({ name, browser_download_url: `https://github.com/a/b/releases/download/v1/${name}` });
  assert.equal(pickAsset({ assets: [{ name: "SHA256SUMS.txt" }, nro("ytb-player.nro")] }, "m/ytb-player").name, "ytb-player.nro");
  assert.equal(pickAsset({ assets: [nro("debug.nro"), nro("ytb-player.nro")] }, "m/ytb-player").name, "ytb-player.nro");
  assert.equal(pickAsset({ assets: [nro("b.nro"), nro("a.nro")] }, "m/other").name, "a.nro");
  assert.equal(pickAsset({ assets: [{ name: "app.nsp" }] }, "m/x"), null);
  assert.equal(pickAsset({ assets: [{ name: "x.nro", browser_download_url: "http://evil.example/x.nro" }] }, "m/x"), null);
});

test("file names stay inside one folder of the SD card", () => {
  assert.equal(safeFileName("ytb-player.nro", "fallback"), "ytb-player.nro");
  assert.equal(safeFileName("../../boot.nro", "fallback"), "fallback.nro");
  assert.equal(safeFileName("my app.nro", "fallback"), "fallback.nro");
});

test("hand-placed .nro files are listed with what their NACP says", async () => {
  const root = tmp("hb-manual-");
  const nro = fakeNro("Tool", "1.4.0", "Maker");
  fs.mkdirSync(path.join(root, "tool"));
  fs.writeFileSync(path.join(root, "tool", "tool.nro"), nro);
  fs.mkdirSync(path.join(root, "empty"));
  fs.mkdirSync(path.join(root, "broken"));
  fs.writeFileSync(path.join(root, "broken", "broken.nro"), "not an nro");

  const entries = await scanManual(root);
  assert.equal(entries.length, 1);
  const [e] = entries;
  assert.match(e.id, /^m-[0-9a-f]{12}$/);
  assert.deepEqual(
    { name: e.name, version: e.version, author: e.author, hash: e.hash, size: e.size, file_name: e.file_name, source: e.source, repo_url: e.repo_url },
    { name: "Tool", version: "1.4.0", author: "Maker", hash: sha256(nro), size: nro.length, file_name: "tool.nro", source: "manual", repo_url: null },
  );
  assert.deepEqual(await scanManual(path.join(root, "missing")), []);
});

test("the first check of a repository fetches the build once, to learn its name and icon", async () => {
  const gh = fakeGitHub("murat303/ytb-player");
  const nro = fakeNro("YTB Player", "1.1.0", "murat303");
  gh.publish("v1.1.0", nro);
  const tracker = createTracker({ repos: ["murat303/ytb-player"], stateDir: tmp("hb-gh-"), fetchImpl: gh.fetchImpl, token: "tkn" });

  await tracker.checkAll();
  const [e] = tracker.entries();
  assert.equal(e.name, "YTB Player");
  assert.equal(e.version, "1.1.0");
  assert.equal(e.author, "murat303");
  assert.equal(e.size, nro.length);
  assert.equal(e.hash, `sha256:${sha256(nro)}`);
  assert.equal(e.file_name, "ytb-player.nro");
  assert.equal(e.source, "github");
  assert.equal(e.repo_url, "https://github.com/murat303/ytb-player");
  assert.equal(e.released_at, "2026-09-26T20:06:01Z");
  assert.equal(gh.downloads(), 1);
  const api = gh.apiCalls()[0].headers;
  assert.equal(api.Authorization, "Bearer tkn");
  assert.ok(api["User-Agent"]);
});

test("an unchanged release costs one conditional request and no download", async () => {
  const gh = fakeGitHub("murat303/ytb-player");
  gh.publish("v1.1.0", fakeNro("YTB Player", "1.1.0"));
  let now = 0;
  const tracker = createTracker({ repos: ["murat303/ytb-player"], stateDir: tmp("hb-gh-"), fetchImpl: gh.fetchImpl, now: () => now });
  await tracker.checkAll();
  const before = tracker.entries()[0];

  await tracker.checkAll(); // within three hours: no request at all
  assert.equal(gh.apiCalls().length, 1);

  now += 3 * 60 * 60 * 1000;
  await tracker.checkAll();
  assert.equal(gh.apiCalls().length, 2);
  assert.equal(gh.apiCalls()[1].headers["If-None-Match"], '"v1.1.0"');
  assert.equal(gh.downloads(), 1);
  assert.deepEqual(tracker.entries()[0], before);
});

test("a new release only announces itself; the build is fetched when someone downloads it", async () => {
  const gh = fakeGitHub("murat303/ytb-player");
  const stateDir = tmp("hb-gh-");
  gh.publish("v1.1.0", fakeNro("YTB Player", "1.1.0"));
  let now = 0;
  const tracker = createTracker({ repos: ["murat303/ytb-player"], stateDir, fetchImpl: gh.fetchImpl, now: () => now });
  await tracker.checkAll();
  const oldHash = tracker.entries()[0].hash;

  const next = fakeNro("YTB Player", "1.2.0");
  gh.publish("v1.2.0", next);
  now += 3 * 60 * 60 * 1000;
  await tracker.checkAll();
  const announced = tracker.entries()[0];
  assert.notEqual(announced.hash, oldHash);
  assert.equal(announced.version, "1.2.0");
  assert.equal(announced.name, "YTB Player");
  assert.equal(gh.downloads(), 1);

  const file = await tracker.ensureDownloaded(announced.id);
  assert.deepEqual(fs.readFileSync(file.path), next);
  assert.equal(file.sha256, sha256(next));
  assert.equal(gh.downloads(), 2);
  await tracker.ensureDownloaded(announced.id);
  assert.equal(gh.downloads(), 2);
  assert.equal(fs.readdirSync(path.join(stateDir, announced.id)).filter((f) => f.endsWith(".nro")).length, 1);
});

test("a build whose digest does not match is refused", async () => {
  const gh = fakeGitHub("a/ytb-player");
  gh.publish("v1", fakeNro("App", "1"));
  let now = 0;
  const tracker = createTracker({ repos: ["a/ytb-player"], stateDir: tmp("hb-gh-"), fetchImpl: gh.fetchImpl, now: () => now });
  await tracker.checkAll();
  gh.publish("v2", fakeNro("App", "2"));
  gh.state.release.json.assets[1].digest = `sha256:${"0".repeat(64)}`;
  now += 3 * 60 * 60 * 1000;
  await tracker.checkAll();
  const [e] = tracker.entries();
  await assert.rejects(tracker.ensureDownloaded(e.id), /digest/);

  // The first build is never listed when it could not be fetched.
  const fresh = fakeGitHub("b/ytb-player");
  fresh.publish("v1", fakeNro("App", "1"));
  fresh.state.release.json.assets[1].digest = `sha256:${"0".repeat(64)}`;
  const other = createTracker({ repos: ["b/ytb-player"], stateDir: tmp("hb-gh-"), fetchImpl: fresh.fetchImpl });
  await other.checkAll();
  assert.deepEqual(other.entries(), []);
});

test("what was learned survives a restart without asking GitHub again", async () => {
  const gh = fakeGitHub("murat303/ytb-player");
  const stateDir = tmp("hb-gh-");
  gh.publish("v1.1.0", fakeNro("YTB Player", "1.1.0"));
  const first = createTracker({ repos: ["murat303/ytb-player"], stateDir, fetchImpl: gh.fetchImpl, now: () => 0 });
  await first.checkAll();

  const second = createTracker({ repos: ["murat303/ytb-player"], stateDir, fetchImpl: gh.fetchImpl, now: () => 1000 });
  await second.checkAll();
  assert.equal(gh.apiCalls().length, 1);
  assert.deepEqual(second.entries(), first.entries());
});

test("a repository that is no longer configured is not listed", async () => {
  const gh = fakeGitHub("murat303/ytb-player");
  const stateDir = tmp("hb-gh-");
  gh.publish("v1.1.0", fakeNro("YTB Player", "1.1.0"));
  await createTracker({ repos: ["murat303/ytb-player"], stateDir, fetchImpl: gh.fetchImpl }).checkAll();
  assert.deepEqual(createTracker({ repos: [], stateDir, fetchImpl: gh.fetchImpl }).entries(), []);
});

test("a failing GitHub leaves the last known entry in place", async () => {
  const gh = fakeGitHub("murat303/ytb-player");
  gh.publish("v1.1.0", fakeNro("YTB Player", "1.1.0"));
  let now = 0;
  let down = false;
  const fetchImpl = (url, opts) => (down ? Promise.reject(new Error("offline")) : gh.fetchImpl(url, opts));
  const tracker = createTracker({ repos: ["murat303/ytb-player"], stateDir: tmp("hb-gh-"), fetchImpl, now: () => now });
  await tracker.checkAll();
  const before = tracker.entries();
  down = true;
  now += 3 * 60 * 60 * 1000;
  await tracker.checkAll();
  assert.deepEqual(tracker.entries(), before);
});

test("a first build that failed to arrive is fetched again on the next check, even when the release is unchanged", async () => {
  const gh = fakeGitHub("murat303/ytb-player");
  gh.publish("v1.1.0", fakeNro("YTB Player", "1.1.0"));
  let now = 0;
  let broken = true;
  const fetchImpl = (url, opts) =>
    broken && url.startsWith("https://github.com/") ? Promise.resolve(new Response("busy", { status: 503 })) : gh.fetchImpl(url, opts);
  const tracker = createTracker({ repos: ["murat303/ytb-player"], stateDir: tmp("hb-gh-"), fetchImpl, now: () => now });
  await tracker.checkAll();
  assert.deepEqual(tracker.entries(), []);

  broken = false;
  now += 3 * 60 * 60 * 1000;
  await tracker.checkAll();
  assert.equal(tracker.entries()[0]?.name, "YTB Player");
});

test("a download larger than the release says is cut off", async () => {
  const gh = fakeGitHub("a/ytb-player");
  const nro = fakeNro("App", "1");
  gh.publish("v1", nro, { digest: false });
  gh.state.release.json.assets[1].size = 100; // GitHub claims 100 bytes, the body is far bigger
  const stateDir = tmp("hb-gh-");
  const tracker = createTracker({ repos: ["a/ytb-player"], stateDir, fetchImpl: gh.fetchImpl });
  await tracker.checkAll();
  assert.deepEqual(tracker.entries(), []);
  const left = fs.readdirSync(stateDir, { recursive: true }).filter((f) => String(f).endsWith(".nro") || String(f).endsWith(".part"));
  assert.deepEqual(left, []);
});

test("an unreadable app folder leaves the other hand-placed apps listed", async (t) => {
  if (process.getuid?.() === 0) return t.skip("root reads everything");
  const root = tmp("hb-manual-");
  fs.mkdirSync(path.join(root, "good"));
  fs.writeFileSync(path.join(root, "good", "good.nro"), fakeNro("Good", "1"));
  fs.mkdirSync(path.join(root, "locked"));
  fs.chmodSync(path.join(root, "locked"), 0o000);
  try {
    assert.deepEqual((await scanManual(root)).map((e) => e.name), ["Good"]);
  } finally {
    fs.chmodSync(path.join(root, "locked"), 0o755);
  }
});
