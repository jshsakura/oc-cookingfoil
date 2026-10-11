import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { tarEntries, archive } from "../../src/helpers/tar-stream.js";
import { archiveSize, paxRecord, splitPath } from "../../src/helpers/ustar.js";

// Korean titles are 3 bytes a character, so a real retro ROM name overflows
// ustar's 100-byte name field; the archive must still unpack to that exact path.
const LONG = "roms/nes/SD 건담 - 가샤폰 전사 3 - 영웅전기 (SD Gundam - Gachapon Senshi 3 - Eiyuu Senki) [J-K v20120916].zip";
const LONG_DIR = `${"아주 긴 폴더 이름 ".repeat(8).trim()}/게임.sfc`;

test("pax records count their own length", () => {
  for (const value of ["a", "x".repeat(90), "가".repeat(40), "y".repeat(995)]) {
    const rec = paxRecord("path", value);
    assert.equal(Number(rec.toString("utf8").split(" ")[0]), rec.length);
  }
});

test("long Korean paths unpack exactly with tar, and Content-Length matches the bytes", async () => {
  assert.equal(splitPath(LONG), null, "this name really is too long for plain ustar");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tar-long-"));
  const files = [
    { path: LONG, data: Buffer.from("ROM"), size: 3, mtime: 0 },
    { path: LONG_DIR, data: Buffer.from("SFC!"), size: 4, mtime: 0 },
    { path: "retroarch/short.cfg", data: Buffer.from("a = 1\n"), size: 6, mtime: 0 },
  ];
  const entries = tarEntries(files);
  const chunks = [];
  for await (const chunk of archive(entries)) chunks.push(chunk);
  const tar = Buffer.concat(chunks);
  assert.equal(tar.length, archiveSize(entries), "the announced size is exact");
  const tarFile = path.join(dir, "bundle.tar");
  fs.writeFileSync(tarFile, tar);
  const out = path.join(dir, "out");
  fs.mkdirSync(out);
  execFileSync("tar", ["-xf", tarFile, "-C", out]);
  assert.equal(fs.readFileSync(path.join(out, LONG), "utf8"), "ROM");
  assert.equal(fs.readFileSync(path.join(out, LONG_DIR), "utf8"), "SFC!");
  assert.equal(fs.readFileSync(path.join(out, "retroarch/short.cfg"), "utf8"), "a = 1\n");
  assert.ok(!fs.existsSync(path.join(out, "PaxPath")), "no stand-in names left behind");
});
