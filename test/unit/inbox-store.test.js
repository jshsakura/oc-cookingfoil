import { render } from "../../src/helpers/alert-messages.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The share inbox on disk: one folder per upload, built in staging and renamed
// into place, with the files under files/ and what was said in note.json.
const data = fs.mkdtempSync(path.join(os.tmpdir(), "cook-inbox-"));
process.env.COOK_DATA_DIR = data;
const inbox = await import("../../src/meta/inbox.js");

const sha = (text) => crypto.createHash("sha256").update(text).digest("hex");

/** Writes `files` ({ name: text }) into a new staging folder, as multer would. */
async function staged(files) {
  const work = await inbox.newStaging();
  return {
    work,
    files: Object.entries(files).map(([name, text], i) => {
      const p = path.join(work, "in", `f${i}`);
      fs.writeFileSync(p, text);
      return { path: p, name };
    }),
  };
}

test("a file keeps its own name, without folders, control characters or a way out", () => {
  assert.equal(inbox.fileNameOf("세이브 백업.zip"), "세이브 백업.zip");
  assert.equal(inbox.fileNameOf("../../etc/passwd"), "passwd");
  assert.equal(inbox.fileNameOf("C:\\Users\\me\\a.txt"), "a.txt");
  assert.equal(inbox.fileNameOf("a\u0000b\u001f\u007fc.txt"), "abc.txt");
  for (const odd of ["", ".", "..", "   ", "\u0001"]) assert.equal(inbox.fileNameOf(odd), "file");
  const long = inbox.fileNameOf(`${"가".repeat(400)}.nro`);
  assert.ok(long.length <= 200 && long.endsWith(".nro"));
});

test("bidi controls are dropped, so a name can't show its extension backwards", () => {
  assert.equal(inbox.fileNameOf("x\u202Egpj.exe"), "xgpj.exe");
  assert.equal(inbox.fileNameOf("\u200Ea\u200F\u202Ab\u202B\u202Cc\u202D\u2066d\u2067\u2068\u2069.txt"), "abcd.txt");
  assert.equal(inbox.relPathOf("dir\u202E/x\u2066.bin"), "dir/x.bin");
});

test("a folder keeps its inner paths, each part cleaned, and never leaves files/", () => {
  assert.equal(inbox.relPathOf("my mod/romfs/data.bin"), "my mod/romfs/data.bin");
  assert.equal(inbox.relPathOf("../a/./b\\..\\c.txt"), "a/b/c.txt");
  assert.equal(inbox.relPathOf("/abs/x"), "abs/x");
  assert.equal(inbox.relPathOf(""), "file");
});

test("names that would land on each other are told apart", () => {
  assert.deepEqual(inbox.uniquePaths(["a.txt", "A.TXT", "a.txt", "b", "dir/a.txt"]), ["a.txt", "A (2).TXT", "a (3).txt", "b", "dir/a.txt"]);
});

test("links are http or https, one per line or a list, and memos are trimmed and capped", () => {
  assert.deepEqual(inbox.parseLinks("https://a.example/x\n\n http://b.example \nhttps://a.example/x"), ["https://a.example/x", "http://b.example/"]);
  assert.deepEqual(inbox.parseLinks(["https://c.example"]), ["https://c.example/"]);
  assert.deepEqual(inbox.parseLinks(undefined), []);
  for (const bad of ["javascript:alert(1)", "ftp://x.example", "not a url", "file:///etc/passwd"]) {
    assert.throws(() => inbox.parseLinks(bad), (err) => err instanceof inbox.InboxError && err.status === 400 && err.code === "bad-link");
  }
  assert.throws(() => inbox.parseLinks(Array.from({ length: 21 }, (_, i) => `https://x.example/${i}`)), /링크/);
  assert.equal(inbox.cleanMemo("  첫 줄\r\n둘째 줄  "), "첫 줄\n둘째 줄");
  assert.throws(() => inbox.cleanMemo("x".repeat(10_001)), (err) => err.code === "memo-too-long");
});

test("an entry id names the time and the person, and only ids of that shape are accepted", () => {
  const id = inbox.entryId("alice", new Date(2026, 9, 14, 9, 5, 7), "0a1b");
  assert.equal(id, "20261014-090507-alice-0a1b");
  assert.equal(inbox.entryId("김 철수/../x", new Date(2026, 0, 2, 3, 4, 5), "ffff"), "20260102-030405-_x-ffff");
  assert.ok(inbox.isEntryId(id));
  for (const bad of ["..", "x", "20261014-090507-alice-0a1b/../../etc", ".staging"]) assert.equal(inbox.isEntryId(bad), false);
});

test("an upload appears whole: files, hashes and note.json, and nothing is left in staging", async () => {
  const { work, files } = await staged({ "save.zip": "zip bytes", "readme.txt": "hello" });
  const note = await inbox.create({
    user: "alice", slug: "alice", work, files, memo: "피크민 세이브입니다\n두 번째 줄", links: ["https://a.example/"],
    now: new Date(2026, 9, 14, 9, 5, 7),
  });
  assert.match(note.id, /^20261014-090507-alice-[0-9a-f]{4}$/);
  const dir = path.join(data, "inbox", note.id);
  const saved = JSON.parse(fs.readFileSync(path.join(dir, "note.json"), "utf8"));
  assert.deepEqual(Object.keys(saved), ["user", "at", "memo", "links", "files"]);
  assert.equal(saved.user, "alice");
  assert.equal(saved.at, new Date(2026, 9, 14, 9, 5, 7).toISOString());
  assert.deepEqual(saved.files, [
    { name: "save.zip", size: 9, sha256: sha("zip bytes") },
    { name: "readme.txt", size: 5, sha256: sha("hello") },
  ]);
  assert.equal(fs.readFileSync(path.join(dir, "files", "readme.txt"), "utf8"), "hello");
  assert.equal(fs.existsSync(work), false);
  assert.deepEqual(fs.readdirSync(path.join(data, "inbox", ".staging")), []);
});

test("a memo or links alone is an entry too, with an empty files folder", async () => {
  const work = await inbox.newStaging();
  const note = await inbox.create({ user: "bob", slug: "bob", work, files: [], memo: "링크만 남깁니다", links: [], now: new Date(2026, 9, 14, 10, 0, 0) });
  assert.deepEqual(fs.readdirSync(path.join(data, "inbox", note.id, "files")), []);
});

test("the list is newest first, carries the size, and a done entry hides under the filter", async () => {
  const all = await inbox.list();
  assert.deepEqual(all.map((e) => e.user), ["bob", "alice"]);
  assert.equal(all[1].bytes, 14);
  assert.equal(all[1].done, false);
  await inbox.setDone(all[1].id, true);
  assert.deepEqual((await inbox.list({ done: false })).map((e) => e.user), ["bob"]);
  assert.deepEqual((await inbox.list({ done: true })).map((e) => e.user), ["alice"]);
  await inbox.setDone(all[1].id, false);
  assert.equal((await inbox.list({ done: false })).length, 2);
  assert.equal(await inbox.usage(), 14 + fs.statSync(path.join(data, "inbox", all[0].id, "note.json")).size + fs.statSync(path.join(data, "inbox", all[1].id, "note.json")).size);
});

test("a file path resolves only inside its own entry", async () => {
  const [, alice] = await inbox.list();
  assert.equal(inbox.filePath(alice.id, "readme.txt"), path.join(data, "inbox", alice.id, "files", "readme.txt"));
  for (const bad of ["../note.json", "../../x", "/etc/passwd", ""]) assert.equal(inbox.filePath(alice.id, bad), null, bad);
  assert.equal(inbox.filePath("../x", "readme.txt"), null);
  assert.equal(inbox.filePath(alice.id, "missing.txt"), null);
});

test("deleting removes one entry folder and nothing else", async () => {
  const [bob, alice] = await inbox.list();
  assert.equal(await inbox.remove(bob.id), true);
  assert.equal(await inbox.remove(bob.id), false);
  assert.equal(await inbox.remove("../../security"), false);
  assert.deepEqual((await inbox.list()).map((e) => e.id), [alice.id]);
});

test("the alert tells who, how many files and how big, the link count and the memo's first line", () => {
  const text = render(inbox.alertText({ user: "alice", memo: "  \n  피크민 세이브입니다  \n둘째 줄", links: ["https://a.example/", "https://b.example/"], files: [{ size: 1024 }, { size: 2048 }] }), "ko");
  assert.equal(text, "📦 alice 님이 파일 2개(3.0 KB), 링크 2개를 올렸습니다.\n📝 메모: 피크민 세이브입니다");
  assert.equal(render(inbox.alertText({ user: "bob", memo: "", links: [], files: [] }), "ko"), "📦 bob 님이 파일 0개(0 B), 링크 0개를 올렸습니다.");
});

test("leftovers in staging from a stopped server are cleared, and the usage figure is kept between changes", async () => {
  const work = await inbox.newStaging();
  fs.writeFileSync(path.join(work, "in", "f0"), "x".repeat(5000));
  inbox.clearStaging();
  assert.deepEqual(fs.readdirSync(path.join(data, "inbox", ".staging")), []);
  const before = await inbox.usage();
  // a file put there behind the server's back is not seen until the figure is renewed
  const [entry] = await inbox.list();
  fs.writeFileSync(path.join(data, "inbox", entry.id, "files", "extra.bin"), "y".repeat(100));
  assert.equal(await inbox.usage(), before);
  assert.equal(await inbox.usage({ fresh: true }), before + 100);
  // its own changes renew it at once
  await inbox.remove(entry.id);
  assert.equal(await inbox.usage(), 0);
});
