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
  assert.equal(safeFileName("내 앱.nro", "내 앱 폴더"), "app.nro", "a fallback is made plain as well");
  assert.equal(safeFileName("x y.nro", "My Tool v2"), "My-Tool-v2.nro");
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

// ── choosing the file, zipped builds, and the admin's list ────────────────
import { execFileSync, spawnSync } from "node:child_process";
import { extractNro, globRegExp, pickZipEntry } from "../../src/meta/homebrew.js";

const gh = (name) => ({ name, browser_download_url: `https://github.com/o/r/releases/download/v1/${name}` });

test("a release with several files picks the one named after the repository, or the one the admin chose", () => {
  assert.equal(pickAsset({ assets: [gh("ftpd-classic.nro"), gh("ftpd.nro")] }, "mtheall/ftpd").name, "ftpd.nro");
  assert.equal(pickAsset({ assets: [gh("SimpleModManagerConsole.nro"), gh("SimpleModManager.nro")] }, "nadrino/SimpleModManager").name, "SimpleModManager.nro");
  assert.equal(pickAsset({ assets: [gh("NXThemesInstaller.nro"), gh("NxThemeTool.zip")] }, "exelix11/SwitchThemeInjector").name, "NXThemesInstaller.nro");
  assert.equal(pickAsset({ assets: [gh("ftpd-classic.nro"), gh("ftpd.nro")] }, "mtheall/ftpd", "*-classic.nro").name, "ftpd-classic.nro");
  assert.equal(pickAsset({ assets: [gh("ftpd.nro")] }, "mtheall/ftpd", "nothing.nro"), null);
  assert.ok(globRegExp("nxmp-*.zip").test("NXMP-0.9.3.zip"));
  assert.ok(!globRegExp("a.nro").test("a-nro"), "dots are literal");
});

test("without a .nro, the zip that isn't another platform's build is used", () => {
  const assets = ["wiliwili-Windows-x86_64.zip", "wiliwili-Windows-arm64.zip", "wiliwili-Windows-x86-OldGPU.zip", "wiliwili-HomebrewBuild.zip"].map(gh);
  assert.equal(pickAsset({ assets }, "xfangfang/wiliwili").name, "wiliwili-HomebrewBuild.zip");
  assert.equal(pickAsset({ assets: [gh("nxmp-0.9.3.zip")] }, "proconsule/nxmp").name, "nxmp-0.9.3.zip");
  assert.equal(pickAsset({ assets: [gh("Tool-windows-x64.zip")] }, "o/tool"), null);
  assert.equal(pickZipEntry(["switch/Fizeau/", "switch/Fizeau/Fizeau.nro", "atmosphere/x.ovl"], "averne/Fizeau"), "switch/Fizeau/Fizeau.nro");
  assert.equal(pickZipEntry(["readme.txt"], "o/r"), null);
});

/** A zip holding `files` ({ "path/in/zip": Buffer }), written by Python so any entry name is possible. */
function makeZip(files) {
  const dir = tmp("hb-zip-");
  const zip = path.join(dir, "build.zip");
  const spec = path.join(dir, "spec.json");
  fs.writeFileSync(spec, JSON.stringify(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, v.toString("base64")]))));
  execFileSync("python3", ["-I", "-c", `
import base64, json, sys, zipfile
files = json.load(open(sys.argv[1]))
with zipfile.ZipFile(sys.argv[2], "w", zipfile.ZIP_DEFLATED) as z:
    for name, data in files.items():
        z.writestr(name, base64.b64decode(data))
`, spec, zip]);
  return zip;
}

test("the .nro is copied out of a zip without trusting the zip's paths or sizes", async () => {
  const nro = fakeNro("Zipped", "2.0");
  const dir = tmp("hb-out-");
  const zip = makeZip({ "switch/zipped/zipped.nro": nro, "README.md": Buffer.from("hi") });
  const dest = path.join(dir, "out.nro");
  assert.equal(await extractNro(zip, "o/zipped", dest), "zipped.nro");
  assert.deepEqual(fs.readFileSync(dest), nro);

  // A "../" entry lands in our own file, never next to it.
  const sneaky = makeZip({ "../../escaped.nro": nro });
  const dest2 = path.join(dir, "sneaky.nro");
  assert.equal(await extractNro(sneaky, "o/r", dest2), "escaped.nro");
  assert.deepEqual(fs.readFileSync(dest2), nro);
  assert.ok(!fs.existsSync(path.join(dir, "..", "escaped.nro")) && !fs.existsSync(path.join(dir, "..", "..", "escaped.nro")));

  // A tiny zip that inflates past the limit is cut off.
  const bomb = makeZip({ "bomb.nro": Buffer.alloc(4 * 1024 * 1024) });
  await assert.rejects(extractNro(bomb, "o/bomb", path.join(dir, "bomb.nro"), 1024 * 1024), /larger than/);
});

test("a zipped release is served as the .nro inside it", async () => {
  const nro = fakeNro("Zipped App", "3.1", "Maker");
  const zipBuf = fs.readFileSync(makeZip({ "switch/zapp/zapp.nro": nro }));
  const url = "https://github.com/o/zapp/releases/download/v3/zapp.zip";
  const release = { tag_name: "v3", published_at: null, assets: [{ id: 7, name: "zapp.zip", size: zipBuf.length, browser_download_url: url, digest: `sha256:${sha256(zipBuf)}` }] };
  const fetchImpl = async (u) => (u.startsWith("https://api.github.com/") ? new Response(JSON.stringify(release), { status: 200, headers: { ETag: '"z"' } }) : new Response(zipBuf, { status: 200 }));
  const tracker = createTracker({ repos: ["o/zapp"], stateDir: tmp("hb-gh-"), fetchImpl });
  await tracker.checkAll();
  const [e] = tracker.entries();
  assert.deepEqual([e.name, e.version, e.file_name, e.size], ["Zipped App", "3.1", "zapp.nro", nro.length]);
  const file = await tracker.ensureDownloaded(e.id);
  assert.deepEqual(fs.readFileSync(file.path), nro);
  assert.equal(file.sha256, sha256(nro));
});

test("the admin's list can change at run time; a check can be forced; failures are kept and retried hourly", async () => {
  const hub = fakeGitHub("murat303/ytb-player");
  hub.publish("v1.1.0", fakeNro("YTB Player", "1.1.0"));
  const stateDir = tmp("hb-gh-");
  let now = 0;
  const tracker = createTracker({ sources: [], stateDir, fetchImpl: hub.fetchImpl, now: () => now });
  assert.deepEqual(tracker.entries(), []);
  tracker.setSources([{ repo: "murat303/ytb-player", asset: null }]);
  await tracker.checkNow("murat303/ytb-player");
  const [s] = tracker.status();
  assert.deepEqual([s.repo, s.tag, s.chosen, s.cached.version, s.error], ["murat303/ytb-player", "v1.1.0", "ytb-player.nro", "1.1.0", null]);
  assert.deepEqual(s.assets, ["ytb-player.nro"]);

  await tracker.checkNow("murat303/ytb-player");
  assert.equal(hub.apiCalls().length, 2, "a forced check ignores the three-hour wait");

  // The admin picks a file that isn't there: the error is kept and not retried on every poll.
  tracker.setSources([{ repo: "murat303/ytb-player", asset: "nothing.nro" }]);
  await tracker.checkNow("murat303/ytb-player");
  assert.match(tracker.status()[0].error.message, /no file matching nothing\.nro/);
  now += 15 * 60 * 1000;
  await tracker.checkAll();
  assert.equal(hub.apiCalls().length, 3, "no retry within the hour");
  now += 60 * 60 * 1000;
  await tracker.checkAll();
  assert.equal(hub.apiCalls().length, 4);

  const id = tracker.status()[0].id;
  tracker.setSources([]);
  await tracker.forget("murat303/ytb-player");
  assert.deepEqual(tracker.status(), []);
  assert.ok(!fs.existsSync(path.join(stateDir, id)), "its cached build is gone");
});

test("COOK_HOMEBREW_REPOS seeds the admin's list once; the list file wins afterwards", () => {
  const data = tmp("hb-src-");
  const run = (script, repos) => JSON.parse(spawnSync(process.execPath, ["--input-type=module", "-e", `
    import * as s from "../../src/meta/homebrew-sources.js";
    const out = await (async () => { ${script} })();
    process.stdout.write(JSON.stringify(out));
  `], { cwd: import.meta.dirname, env: { ...process.env, COOK_DATA_DIR: data, COOK_HOMEBREW_REPOS: repos }, encoding: "utf8" }).stdout);
  assert.deepEqual(run(`return s.list().map((x) => x.repo);`, "murat303/ytb-player,https://github.com/mtheall/ftpd,bad"), ["murat303/ytb-player", "mtheall/ftpd"]);
  assert.deepEqual(run(`s.remove("mtheall/ftpd"); s.add("github.com/J-D-K/JKSV"); s.setAsset("murat303/ytb-player", "*.nro"); return s.list().map((x) => [x.repo, x.asset]);`, "mtheall/ftpd"),
    [["murat303/ytb-player", "*.nro"], ["J-D-K/JKSV", null]]);
  assert.deepEqual(run(`return s.list().map((x) => x.repo);`, "something/else"), ["murat303/ytb-player", "J-D-K/JKSV"], "the env is not read again");
  assert.deepEqual(run(`const e = []; for (const f of [() => s.add("not a repo"), () => s.setAsset("J-D-K/JKSV", "evil.exe")]) { try { f(); e.push(null); } catch (x) { e.push(x.message); } } return e;`, ""),
    ["GitHub 저장소 주소가 아닙니다", "파일 이름 패턴은 .nro 나 .zip 으로 끝나야 합니다"]);
});

test("a repository's own GitHub description is learned once, apart from the release checks", async () => {
  const hub = fakeGitHub("murat303/ytb-player");
  hub.publish("v1.1.0", fakeNro("YTB Player", "1.1.0"));
  let asked = 0;
  const fetchImpl = async (url, opts) => {
    if (url !== "https://api.github.com/repos/murat303/ytb-player") return hub.fetchImpl(url, opts);
    asked++;
    return new Response(JSON.stringify({ description: "  A YouTube player.  " }), { status: 200 });
  };
  const tracker = createTracker({ repos: ["murat303/ytb-player"], stateDir: tmp("hb-gh-"), fetchImpl });
  await tracker.checkAll();
  assert.equal(tracker.entries()[0].description, null, "not before it is asked for");
  await tracker.fetchDescriptions();
  assert.equal(tracker.entries()[0].description, "A YouTube player.");
  await tracker.fetchDescriptions();
  assert.equal(asked, 1, "asked once, not every time");
});

// ── folder installs ─────────────────────────────────────────────────────────
import { installPathFor, packageLayout, zipEntries } from "../../src/meta/homebrew.js";

const ent = (name, extra = {}) => ({ name, size: 1, dir: name.endsWith("/"), link: false, ...extra });

test("a zip installs as a folder only when it is exactly one switch/<app>/ with one .nro and nothing foreign", () => {
  const ok = packageLayout([ent("switch/"), ent("switch/acnh_editor/"), ent("switch/acnh_editor/acnh_editor.nro"), ent("switch/acnh_editor/font.ttf"), ent("switch/acnh_editor/data/items.txt")]);
  assert.equal(ok.folder.dir, "switch/acnh_editor");
  assert.equal(ok.folder.nro, "switch/acnh_editor/acnh_editor.nro");
  assert.deepEqual(ok.folder.files.map((f) => f.path), ["switch/acnh_editor/acnh_editor.nro", "switch/acnh_editor/font.ttf", "switch/acnh_editor/data/items.txt"]);

  const reason = (names, extra) => packageLayout(names.map((n) => ent(n, extra?.[n]))).reason;
  assert.equal(reason(["app.nro", "font.ttf"]), "not-one-folder", "files at the top");
  assert.equal(reason(["wrap/switch/app/app.nro", "wrap/switch/app/a.txt"]), "not-one-folder", "a wrapper folder");
  assert.equal(reason(["switch/a/a.nro", "switch/b/b.txt"]), "not-one-folder", "two apps");
  assert.equal(reason(["switch/a/a.nro", "README.md"]), "not-one-folder", "something beside the folder");
  assert.equal(reason(["switch/a/a.nro", "switch/a/b.nro"]), "several-nro");
  assert.equal(reason(["switch/a/a.txt", "switch/a/b.txt"]), "no-nro");
  assert.equal(reason(["switch/a/a.nro"]), "only-nro");
  assert.equal(reason(["switch/a/a.nro", "switch/a/tool.exe"]), "foreign-file");
  assert.equal(reason(["switch/a/a.nro", "switch/a/x"], { "switch/a/x": { link: true } }), "link");
  assert.equal(reason(["switch/a/a.nro", "switch/a/../../evil"]), "unsafe-path");
  assert.equal(reason(["switch/my app/a.nro", "switch/my app/x.txt"]), "unsafe-path", "the app folder name goes into the shortcut");
});

test("every app lives in its own switch/<app>/ folder", () => {
  assert.equal(installPathFor("ftpd.nro"), "switch/ftpd/ftpd.nro");
  assert.equal(installPathFor("x.nro", "switch/acnh_editor"), "switch/acnh_editor/x.nro");
  assert.equal(installPathFor("x.nro", "switch/bad name"), "switch/x/x.nro");
});

test("zip entries come with their types, so links are seen before anything is unpacked", async () => {
  const dir = tmp("hb-zi-");
  const zip = path.join(dir, "t.zip");
  execFileSync("python3", ["-I", "-c", `
import zipfile, sys
with zipfile.ZipFile(sys.argv[1], "w") as z:
    z.writestr("switch/a/a b.nro", b"x" * 100)
    z.writestr("switch/a/data/", b"")
    i = zipfile.ZipInfo("switch/a/link"); i.create_system = 3; i.external_attr = 0o120777 << 16
    z.writestr(i, "target")
`, zip]);
  assert.deepEqual(await zipEntries(zip), [
    { name: "switch/a/a b.nro", size: 100, dir: false, link: false },
    { name: "switch/a/data/", size: 0, dir: true, link: false },
    { name: "switch/a/link", size: 6, dir: false, link: true },
  ]);
});

/** A GitHub that serves one release with the given zips ({ name: Buffer }). */
function zipRelease(repo, zips) {
  let id = 100;
  const assets = Object.entries(zips).map(([name, buf]) => ({
    id: id++, name, size: buf.length, digest: `sha256:${sha256(buf)}`,
    browser_download_url: `https://github.com/${repo}/releases/download/v1/${name}`,
  }));
  const downloads = [];
  const fetchImpl = async (u) => {
    if (u.startsWith("https://api.github.com/")) return new Response(JSON.stringify({ tag_name: "v1", published_at: null, assets }), { status: 200, headers: { ETag: '"r1"' } });
    const name = u.split("/").pop();
    downloads.push(name);
    return new Response(zips[name], { status: 200 });
  };
  return { fetchImpl, downloads };
}

test("of several zips the one with the app's data wins, and its whole folder is kept", async () => {
  const nro = fakeNro("ACNH Editor", "1.4.0");
  const dbi = fs.readFileSync(makeZip({ "switch/acnh_editor/acnh_editor.nro": nro, "switch/acnh_editor/config.json": Buffer.from("{}") }));
  const full = fs.readFileSync(makeZip({ "switch/acnh_editor/acnh_editor.nro": nro, "switch/acnh_editor/font.ttf": Buffer.from("font"), "switch/acnh_editor/items.txt": Buffer.from("items") }));
  const hub = zipRelease("o/ACNH-Save-Editor", { "acnh_editor_dbi.zip": dbi, "acnh_editor_v1.4.0.zip": full });
  const tracker = createTracker({ repos: ["o/ACNH-Save-Editor"], stateDir: tmp("hb-gh-"), fetchImpl: hub.fetchImpl });
  await tracker.checkAll();
  const [e] = tracker.entries();
  assert.equal(e.install_dir, "switch/acnh_editor");
  assert.equal(e.install_path, "switch/acnh_editor/acnh_editor.nro");
  assert.equal(e.file_name, "acnh_editor.nro");
  assert.deepEqual(e.files.map((f) => [f.path, f.size]), [["switch/acnh_editor/acnh_editor.nro", nro.length], ["switch/acnh_editor/font.ttf", 4], ["switch/acnh_editor/items.txt", 5]]);
  const [s] = tracker.status();
  assert.deepEqual([s.chosen, s.install.mode, s.folder_files], ["acnh_editor_v1.4.0.zip", "folder", 3]);

  const font = tracker.packageFile(e.id, "switch/acnh_editor/font.ttf");
  assert.equal(fs.readFileSync(font.path, "utf8"), "font");
  assert.equal(font.sha256, sha256(Buffer.from("font")));
  assert.equal(tracker.packageFile(e.id, "switch/acnh_editor/../../state.json"), null, "only listed paths");
  assert.deepEqual(fs.readFileSync((await tracker.ensureDownloaded(e.id)).path), nro, "the plain download is still the .nro");

  const before = hub.downloads.length;
  await tracker.checkNow("o/ACNH-Save-Editor");
  assert.equal(tracker.status()[0].chosen, "acnh_editor_v1.4.0.zip", "the comparison is remembered for the same release");
  assert.equal(hub.downloads.length, before, "and nothing is fetched again");
});

test("a zip that isn't one clean app folder is served as its .nro, in its own folder", async () => {
  const nro = fakeNro("Wrapped", "1.0");
  const zip = fs.readFileSync(makeZip({ "Wrapped/switch/wrapped/wrapped.nro": nro, "Wrapped/README.txt": Buffer.from("hi") }));
  const hub = zipRelease("o/wrapped", { "wrapped.zip": zip });
  const tracker = createTracker({ repos: ["o/wrapped"], stateDir: tmp("hb-gh-"), fetchImpl: hub.fetchImpl });
  await tracker.checkAll();
  const [e] = tracker.entries();
  assert.deepEqual([e.files, e.install_dir, e.install_path], [null, null, "switch/wrapped/wrapped.nro"]);
  assert.deepEqual(tracker.status()[0].install, { mode: "nro", reason: "not-one-folder" });

  const plain = createTracker({ repos: ["o/app"], stateDir: tmp("hb-gh-"), fetchImpl: zipRelease("o/app", { "app.zip": fs.readFileSync(makeZip({ "switch/app-dir/app.nro": nro })) }).fetchImpl });
  await plain.checkAll();
  assert.equal(plain.entries()[0].install_path, "switch/app-dir/app.nro", "a lone .nro keeps the zip's folder name");
});

test("an app's shortcut starts the .nro where it is installed", async () => {
  const { homebrewTarget, forwarderSpec } = await import("../../src/retro/forwarder.js");
  assert.equal(homebrewTarget("ftpd.nro").nroPath, "sdmc:/switch/ftpd/ftpd.nro");
  assert.equal(homebrewTarget("x.nro", "switch/acnh_editor/acnh_editor.nro").nroPath, "sdmc:/switch/acnh_editor/acnh_editor.nro");
  assert.equal(homebrewTarget("x.nro", "switch/../x.nro").nroPath, "sdmc:/switch/x/x.nro", "a bad path falls back to the file's own folder");
  // One shortcut per app: moving the app keeps its title id and changes only the build.
  const app = (target) => forwarderSpec({ id: "homebrew-gh-0123456789ab", name: "ACNH", publisher: "o", target, artKey: "h" });
  const before = app(homebrewTarget("acnh_editor.nro")), after = app(homebrewTarget("acnh_editor.nro", "switch/acnh_editor/acnh_editor.nro"));
  assert.equal(before.titleId, after.titleId);
});

test("a build cached before folder installs existed is looked at again and re-fetched once", async () => {
  const nro = fakeNro("Old", "1.0");
  const zip = fs.readFileSync(makeZip({ "switch/old/old.nro": nro, "switch/old/data.bin": Buffer.from("d") }));
  const hub = zipRelease("o/old", { "old.zip": zip });
  const stateDir = tmp("hb-gh-");
  const first = createTracker({ repos: ["o/old"], stateDir, fetchImpl: hub.fetchImpl, now: () => 0 });
  await first.checkAll();
  const id = first.status()[0].id;
  // what an older server wrote: no `install`, no folder
  const file = path.join(stateDir, id, "state.json");
  const st = JSON.parse(fs.readFileSync(file, "utf8"));
  delete st.cached.install; delete st.cached.folder; st.checked_at = 0;
  fs.writeFileSync(file, JSON.stringify(st));
  const again = createTracker({ repos: ["o/old"], stateDir, fetchImpl: hub.fetchImpl, now: () => 1000 });
  await again.checkAll();
  assert.equal(again.status()[0].install.mode, "folder");
  assert.equal(again.entries()[0].files.length, 2);
});
