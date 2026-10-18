import { test } from "node:test";
import assert from "node:assert/strict";

import { parseFromFilename } from "../../src/meta/filename-parser.js";

test("parseFromFilename: base game (000 suffix) is contentType base with self groupTitleId", () => {
  const r = parseFromFilename("Armello [0100E2E00CE7A000][v0].nsp");

  assert.equal(r.titleId, "0100E2E00CE7A000");
  assert.equal(r.contentType, "base");
  assert.equal(r.groupTitleId, "0100E2E00CE7A000");
  assert.equal(r.version, 0);
  assert.equal(r.name, "Armello");
  assert.equal(r.ext, "nsp");
  assert.equal(r.isKnownContainer, true);
});

test("parseFromFilename: update (800 suffix) reports contentType update and rewrites groupTitleId to 000", () => {
  const r = parseFromFilename("Armello [0100E2E00CE7A800][v65536].nsp");

  assert.equal(r.titleId, "0100E2E00CE7A800");
  assert.equal(r.contentType, "update");
  assert.equal(r.groupTitleId, "0100E2E00CE7A000");
  assert.equal(r.version, 65536);
});

test("parseFromFilename: DLC groups under its real base game (add-on ids start at base + 0x1000)", () => {
  // Real library pairs: DAEMON X MACHINA 0100B6400CA56000 owns DLC 0100B6400CA57xxx,
  // DAVE THE DIVER 010097F018538000 owns DLC 010097F018539xxx. Zeroing only the
  // last three digits pointed every DLC at a base game that does not exist.
  const r = parseFromFilename("Daemon X Machina/DLC/Outer Emote Roar [0100B6400CA57090][v0].nsp");

  assert.equal(r.titleId, "0100B6400CA57090");
  assert.equal(r.contentType, "dlc");
  assert.equal(r.groupTitleId, "0100B6400CA56000");
  assert.equal(parseFromFilename("Dave The Diver/DLC/Unknown [010097F018539003][v0].nsp").groupTitleId, "010097F018538000");
  assert.equal(parseFromFilename("X [01000000000FF001].nsp").groupTitleId, "01000000000FE000");
});

test("parseFromFilename: DLC suffix comparison is case-insensitive (uppercase hex 800 still update)", () => {
  // Regex captures hex as-is then .toUpperCase()s it; suffix check lowercases again —
  // exercise a mixed-case source title id to pin that both directions hold.
  const r = parseFromFilename("Game [0100abc001234800].nsp");

  assert.equal(r.titleId, "0100ABC001234800");
  assert.equal(r.contentType, "update");
  assert.equal(r.groupTitleId, "0100ABC001234000");
});

test("parseFromFilename: missing version tag yields version null", () => {
  const r = parseFromFilename("Armello [0100E2E00CE7A000].nsp");

  assert.equal(r.version, null);
  assert.equal(r.titleId, "0100E2E00CE7A000");
});

test("parseFromFilename: missing title id yields null titleId, null groupTitleId, and base contentType", () => {
  const r = parseFromFilename("Homebrew Tool.nro");

  assert.equal(r.titleId, null);
  assert.equal(r.groupTitleId, null);
  assert.equal(r.contentType, "base");
  assert.equal(r.name, "Homebrew Tool");
  assert.equal(r.ext, "nro");
  assert.equal(r.isKnownContainer, true);
});

test("parseFromFilename: unknown extension is reported but isKnownContainer is false", () => {
  const r = parseFromFilename("random-file.zip");

  assert.equal(r.ext, "zip");
  assert.equal(r.isKnownContainer, false);
});

test("parseFromFilename: strips bracket and paren tags and collapses whitespace for display name", () => {
  const r = parseFromFilename("Armello   [0100E2E00CE7A000][v0]  (1.2 GB).nsp");

  assert.equal(r.name, "Armello");
});

test("parseFromFilename: name that is entirely tags falls back to the raw stem instead of empty string", () => {
  const r = parseFromFilename("[0100E2E00CE7A000][v0].nsp");

  // Stripping all bracket/paren tokens leaves an empty string, so the `|| stem`
  // fallback must kick in and the raw stem is used verbatim.
  assert.equal(r.name, "[0100E2E00CE7A000][v0]");
});

test("parseFromFilename: strips leading path components via basename", () => {
  const r = parseFromFilename("/roms/switch/base/Armello [0100E2E00CE7A000][v0].nsp");

  assert.equal(r.name, "Armello");
  assert.equal(r.titleId, "0100E2E00CE7A000");
});

test("parseFromFilename: file with no extension keeps whole basename as stem", () => {
  const r = parseFromFilename("noextensionfile");

  assert.equal(r.ext, "");
  assert.equal(r.name, "noextensionfile");
  assert.equal(r.isKnownContainer, false);
});

test("parseFromFilename: first title id tag wins when multiple are present", () => {
  const r = parseFromFilename("Weird [0100E2E00CE7A000][0100E2E00CE7A800].nsp");

  assert.equal(r.titleId, "0100E2E00CE7A000");
  assert.equal(r.contentType, "base");
});
