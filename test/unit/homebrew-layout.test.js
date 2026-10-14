import { test } from "node:test";
import assert from "node:assert/strict";
import { leftOutOfFolder, normalizeLayout } from "../../src/meta/homebrew-layout.js";

const zip = (...names) => names.map((name) => ({ name, size: 10, dir: name.endsWith("/"), link: false }));
const paths = (r) => r.files.map((f) => f.path);

/** Nothing a layout installs leaves its switch/<app>/ folder. */
function staysInside(r) {
  for (const f of r.files) {
    assert.ok(f.path.startsWith(`${r.appDir}/`), `${f.path} is inside ${r.appDir}/`);
    assert.ok(!f.path.split("/").includes(".."), f.path);
  }
  if (r.nro) assert.ok(r.nro.path.startsWith("switch/") && r.nro.path.split("/").length === 3, r.nro.path);
}

test("1. a wrapping folder is peeled off, then the zip is judged again", () => {
  const r = normalizeLayout(zip("MyApp-v1.2/", "MyApp-v1.2/switch/app/app.nro", "MyApp-v1.2/switch/app/data/a.bin", "MyApp-v1.2/README.md"), { repoName: "MyApp" });
  assert.equal(r.mode, "folder");
  assert.equal(r.appDir, "switch/app");
  assert.deepEqual(r.nro, { entry: "MyApp-v1.2/switch/app/app.nro", path: "switch/app/app.nro" });
  assert.deepEqual(paths(r), ["switch/app/app.nro", "switch/app/data/a.bin"]);
  assert.deepEqual(r.files.map((f) => f.entry), ["MyApp-v1.2/switch/app/app.nro", "MyApp-v1.2/switch/app/data/a.bin"], "unpacked from where they are in the zip");
  assert.ok(r.rules.some((x) => x.startsWith("wrapper: peeled off MyApp-v1.2/")));
  staysInside(r);

  const twice = normalizeLayout(zip("release/MyApp/switch/app/app.nro", "release/MyApp/switch/app/x.dat"));
  assert.deepEqual(paths(twice), ["switch/app/app.nro", "switch/app/x.dat"], "nested wrappers too");
  staysInside(twice);
});

test("2. without switch/: a folder holding the .nro, or the root, becomes switch/<app>/", () => {
  const folder = normalizeLayout(zip("app/app.nro", "app/data/x.bin"));
  assert.equal(folder.mode, "folder");
  assert.equal(folder.appDir, "switch/app");
  assert.deepEqual(paths(folder), ["switch/app/app.nro", "switch/app/data/x.bin"]);
  staysInside(folder);

  const root = normalizeLayout(zip("tool.nro", "tool.cfg", "assets/icon.png"));
  assert.equal(root.appDir, "switch/tool");
  assert.deepEqual(root.nro, { entry: "tool.nro", path: "switch/tool/tool.nro" });
  assert.deepEqual(paths(root), ["switch/tool/assets/icon.png", "switch/tool/tool.cfg", "switch/tool/tool.nro"]);
  staysInside(root);
});

test("3. files outside switch/ are left out, and the admin page is told which", () => {
  const r = normalizeLayout(zip("switch/app/app.nro", "switch/app/d.bin", "atmosphere/contents/0100000000001000/exefs.nsp", "config/app/c.ini"));
  assert.equal(r.mode, "folder");
  assert.equal(r.reason, "partial");
  assert.deepEqual(paths(r), ["switch/app/app.nro", "switch/app/d.bin"]);
  assert.deepEqual(r.excluded, [{ rule: "outside-switch", paths: ["atmosphere/ (1)", "config/ (1)"] }]);
  staysInside(r);
});

test("4. junk files are left out and never stop a folder install", () => {
  const r = normalizeLayout(zip("__MACOSX/switch/app/._app.nro", ".DS_Store", "LICENSE", "notes.txt", "switch/app/app.nro", "switch/app/Thumbs.db", "switch/app/README.md", "switch/app/data/lang/en.txt", "switch/app/data/x.bin"));
  assert.equal(r.mode, "folder");
  assert.equal(r.appDir, "switch/app");
  assert.deepEqual(paths(r), ["switch/app/app.nro", "switch/app/data/lang/en.txt", "switch/app/data/x.bin"], "text data deeper in the app stays");
  assert.ok(r.excluded.some((e) => e.rule === "junk"));
  assert.ok(r.excluded.some((e) => e.rule === "outside-switch" && e.paths.includes("notes.txt")));
  staysInside(r);
});

test("5. among several .nro files the repository's wins; the others stay as data", () => {
  const r = normalizeLayout(zip("switch/ftpd/ftpd-classic.nro", "switch/ftpd/ftpd.nro", "switch/ftpd/x.cfg"), { repoName: "ftpd" });
  assert.equal(r.nro.path, "switch/ftpd/ftpd.nro");
  assert.deepEqual(paths(r), ["switch/ftpd/ftpd-classic.nro", "switch/ftpd/ftpd.nro", "switch/ftpd/x.cfg"]);
  const noRepo = normalizeLayout(zip("switch/tool/b.nro", "switch/tool/a.nro", "switch/tool/x"));
  assert.equal(noRepo.nro.path, "switch/tool/a.nro", "else the first by name, every time");
  const apps = normalizeLayout(zip("switch/aaa/aaa.nro", "switch/aaa/x", "switch/ftpd/ftpd.nro", "switch/ftpd/y"), { repoName: "ftpd" });
  assert.equal(apps.appDir, "switch/ftpd");
  assert.deepEqual(paths(apps), ["switch/ftpd/ftpd.nro", "switch/ftpd/y"]);
  assert.deepEqual(apps.excluded, [{ rule: "other-app", paths: ["switch/ (2)"] }]);
  staysInside(r);
  staysInside(apps);
});

test("the same zip always gives the same result", () => {
  const names = ["w/switch/b/b.nro", "w/switch/a/a.nro", "w/switch/a/x", "w/README", "w/atmosphere/y"];
  const one = normalizeLayout(zip(...names));
  const other = normalizeLayout(zip(...[...names].reverse()));
  assert.deepEqual(one, other);
});

test("a lone .nro, links and escaping paths are never a folder install", () => {
  const lone = normalizeLayout(zip("switch/app/app.nro", "README.md"));
  assert.deepEqual([lone.mode, lone.reason, lone.appDir, lone.nro.path], ["nro", "only-nro", "switch/app", "switch/app/app.nro"]);
  assert.equal(normalizeLayout([{ name: "switch/app/app.nro", size: 1, dir: false, link: false }, { name: "switch/app/l", size: 1, dir: false, link: true }]).reason, "link");
  assert.equal(normalizeLayout(zip("switch/app/app.nro", "switch/app/../../etc/x")).reason, "unsafe-path");
  assert.equal(normalizeLayout(zip("switch/app/data.bin")).reason, "no-nro");
  const foreign = normalizeLayout(zip("switch/app/app.nro", "switch/app/x.bin", "switch/app/tool.exe"));
  assert.deepEqual(paths(foreign), ["switch/app/app.nro", "switch/app/x.bin"]);
  assert.ok(foreign.excluded.some((e) => e.rule === "foreign-file"));
});

test("hand-placed folders leave out guides and clutter, but not data below the top", () => {
  for (const rel of ["설치-스위치.md", "INSTALL.txt", "설명.txt", "index.html", "a/manual.pdf", "x/README_CJK.md", "LICENSE", "a/.DS_Store", "__MACOSX/a/b"]) {
    assert.notEqual(leftOutOfFolder(rel), null, rel);
  }
  for (const rel of ["game.nro", "items.txt", "Data/ServerUrl.txt", "Plugins/HotFixes/meta.txt", "lang/ko.md", "Game.ini"]) {
    assert.equal(leftOutOfFolder(rel), null, rel);
  }
});

const entry = (name) => ({ name, size: 1, dir: false, link: false });

test("a zip's install guide is left out and the rest goes to the console", () => {
  const layout = normalizeLayout(["switch/game/game.nro", "switch/game/설치-스위치.md", "switch/game/items.txt", "switch/game/Data/a.txt"].map(entry), { repoName: "game" });
  assert.equal(layout.mode, "folder");
  assert.deepEqual(layout.files.map((f) => f.path), ["switch/game/Data/a.txt", "switch/game/game.nro", "switch/game/items.txt"]);
  assert.ok(layout.excluded.some((x) => x.rule === "doc"));
});

test("a file the app runs on with a name the console can't create refuses the app, never renamed", () => {
  const layout = normalizeLayout(["switch/game/game.nro", "switch/game/Audio/전투.ogg", "switch/game/Data/x.bin"].map(entry), { repoName: "game" });
  assert.equal(layout.mode, null);
  assert.equal(layout.reason, "console-path");
  assert.equal(layout.nro, null, "nothing to install, so no caller can take the .nro alone");
  assert.deepEqual(layout.problems.map((x) => x.path), ["switch/game/Audio/전투.ogg"]);
});
