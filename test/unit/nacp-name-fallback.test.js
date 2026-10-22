import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// A base title absent from titledb must still surface a real name from the
// NACP data extracted out of the container (COOK_EXTRACT_ICONS), instead of
// collapsing to its filename — which, for token-only filenames, is the bare
// "[TITLEID][vVER]" string. Fallback order: titledb → extracted NACP →
// filename. The id below is synthetic but WELL-FORMED (a real base id ends in
// "000", so groupTitleId == titleId and the extracted-meta lookup key matches).
// extracted-meta is read at module load, so the probe runs in a child process
// with COOK_DATA_DIR pinned to a fixture dir.
const BASE_ID = "0100000000ABC000";

const PROBE = `
  import * as extractedMeta from "../../src/meta/extracted-meta-store.js";
  import { composeSections } from "../../src/create-index-content.js";
  await extractedMeta.load();
  const fm = new Map([
    ["[${BASE_ID}][v0].nsp",       { url: "../hb.nsp", name: "", size: 1 }], // NACP-covered
    ["[0100000000FFF000][v0].nsp", { url: "../un.nsp", name: "", size: 1 }], // neither source
    ["Made Up Game [0100000000DEF000][v0].nsp", { url: "../gb.nsp", name: "", size: 1 }], // garbled NACP name
  ]);
  const items = composeSections(fm, []).sections[0].items;
  process.stdout.write(JSON.stringify(items.map((i) => ({ t: i.title_id, n: i.name }))));
`;

test("composeSections: NACP-extracted name fills in when titledb lacks the title", () => {
  const dd = mkdtempSync(path.join(tmpdir(), "cook-nacp-"));
  try {
    mkdirSync(path.join(dd, "extracted-meta"), { recursive: true });
    writeFileSync(
      path.join(dd, "extracted-meta", `${BASE_ID}.json`),
      JSON.stringify({ name: "Cool Homebrew", publisher: "IndieDev" })
    );
    writeFileSync(
      path.join(dd, "extracted-meta", "0100000000DEF000.json"),
      JSON.stringify({ name: "\uFFFD\u0013\uFFFDx", publisher: "IndieDev" })
    );

    const out = execFileSync(process.execPath, ["--input-type=module", "-e", PROBE], {
      cwd: import.meta.dirname,
      env: { ...process.env, COOK_DATA_DIR: dd, COOK_EXTRACT_ICONS: "off" },
      encoding: "utf-8",
    });
    const items = JSON.parse(out);
    const covered = items.find((i) => i.t === BASE_ID);
    const uncovered = items.find((i) => i.t === "0100000000FFF000");

    // titledb absent → extracted NACP name wins over the filename.
    assert.equal(covered.n, "Cool Homebrew");
    // No titledb AND no extraction → last-resort filename (bare tokens here).
    assert.equal(uncovered.n, "[0100000000FFF000][v0]");
    // A name stored garbled (a compressed NACP read as plain text) is not shown; the filename is.
    assert.equal(items.find((i) => i.t === "0100000000DEF000").n, "Made Up Game");
  } finally {
    rmSync(dd, { recursive: true, force: true });
  }
});

const QUEUE_PROBE = `
  import * as extractedMeta from "../../src/meta/extracted-meta-store.js";
  import * as nacpExtractor from "../../src/meta/nacp-extractor.js";
  import { composeResponse } from "../../src/create-index-content.js";
  await extractedMeta.load();
  const calls = [];
  nacpExtractor.setProvider({ name: "probe", async extract(job) { calls.push(job); return null; } });
  const fm = new Map(["0100000000DEF000", "0100000000ABC000"].map((id) => [
    "[" + id + "][v0].nsp", { url: "../x.nsp", name: "", size: 1, baseTitleId: id },
  ]));
  composeResponse(fm, []);
  await nacpExtractor.whenDrained();
  process.stdout.write(JSON.stringify(calls.map((c) => ({ id: c.baseTitleId, iconsOnly: c.langIconsOnly }))));
`;

test("a library rebuild reads a garbled record's file again in full, and leaves a finished one alone", () => {
  const dd = mkdtempSync(path.join(tmpdir(), "cook-nacp-"));
  try {
    mkdirSync(path.join(dd, "extracted-meta"), { recursive: true });
    writeFileSync(path.join(dd, "extracted-meta", "0100000000DEF000.json"), JSON.stringify({ name: "�\u0013", iconLangs: [] }));
    writeFileSync(path.join(dd, "extracted-meta", "0100000000ABC000.json"), JSON.stringify({ name: "Cool Homebrew", iconLangs: [] }));
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", QUEUE_PROBE], {
      cwd: import.meta.dirname,
      env: { ...process.env, COOK_DATA_DIR: dd, COOK_EXTRACT_ICONS: "missing" },
      encoding: "utf-8",
    });
    assert.deepEqual(JSON.parse(out), [{ id: "0100000000DEF000", iconsOnly: false }]);
  } finally {
    rmSync(dd, { recursive: true, force: true });
  }
});

const CONTENT_META_PROBE = `
  import * as extractedMeta from "../../src/meta/extracted-meta-store.js";
  import * as contentMeta from "../../src/meta/content-meta.js";
  import { composeSections } from "../../src/create-index-content.js";
  import { gameOf } from "../../src/meta/game-info.js";
  await extractedMeta.load();
  await contentMeta.load();
  const fm = new Map([
    ["File Name B [0100000000B00000][v0].nsp", { url: "../b.nsp", name: "", size: 1 }],
    ["File Name C [0100000000C00000][v0].nsp", { url: "../c.nsp", name: "", size: 1 }],
  ]);
  const items = composeSections(fm, []).sections[0].items;
  process.stdout.write(JSON.stringify({
    shop: Object.fromEntries(items.map((i) => [i.title_id, i.name])),
    english: contentMeta.get("0100000000B00000", 0).englishName ?? null,
    gameOfC: gameOf("0100000000C00000")?.name,
  }));
`;

test("an English name stored garbled in content-meta is not shown in the shop list or by gameOf", () => {
  const dd = mkdtempSync(path.join(tmpdir(), "cook-nacp-"));
  try {
    mkdirSync(path.join(dd, "extracted-meta"), { recursive: true });
    writeFileSync(path.join(dd, "extracted-meta", "0100000000B00000.json"), JSON.stringify({ name: "Ab�cd", iconLangs: [], iconMap: 2 }));
    writeFileSync(path.join(dd, "extracted-meta", "0100000000C00000.json"), JSON.stringify({ name: "가상 게임", iconLangs: [], iconMap: 2 }));
    writeFileSync(path.join(dd, "extracted-meta", "content-meta.json"), JSON.stringify({
      "0100000000B00000@0": { installSize: 1, nacpRead: true, englishName: "Ab�cd" },
      "0100000000C00000@0": { installSize: 1, nacpRead: true, englishName: "Ab�cd" },
    }));
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", CONTENT_META_PROBE], {
      cwd: import.meta.dirname,
      env: { ...process.env, COOK_DATA_DIR: dd, COOK_EXTRACT_ICONS: "off" },
      encoding: "utf-8",
    });
    const result = JSON.parse(out);
    assert.equal(result.english, null);
    assert.equal(result.shop["0100000000B00000"], "File Name B");
    assert.equal(result.shop["0100000000C00000"], "가상 게임");
    assert.equal(result.gameOfC, "가상 게임");
  } finally {
    rmSync(dd, { recursive: true, force: true });
  }
});

test("a garbled record of a title titledb knows is read again in full even in the default missing mode", () => {
  const dd = mkdtempSync(path.join(tmpdir(), "cook-nacp-"));
  try {
    mkdirSync(path.join(dd, "extracted-meta"), { recursive: true });
    mkdirSync(path.join(dd, "titledb"), { recursive: true });
    writeFileSync(path.join(dd, "titledb", "US.en.json"), JSON.stringify({
      a: { id: "0100000000DEF000", name: "Known Game" },
      b: { id: "0100000000ABC000", name: "Known Too" },
    }));
    writeFileSync(path.join(dd, "extracted-meta", "0100000000DEF000.json"), JSON.stringify({ name: "�\u0013", iconLangs: [], iconMap: 2 }));
    writeFileSync(path.join(dd, "extracted-meta", "0100000000ABC000.json"), JSON.stringify({ name: "Cool Homebrew", iconLangs: [], iconMap: 2 }));
    const probe = QUEUE_PROBE.replace(
      "await extractedMeta.load();",
      `await extractedMeta.load();
       const titledb = await import("../../src/meta/titledb-store.js");
       await titledb.load();`,
    ).replace("calls.map((c) => ({ id: c.baseTitleId, iconsOnly: c.langIconsOnly }))",
      "calls.map((c) => ({ id: c.baseTitleId, iconsOnly: c.langIconsOnly, wantMeta: c.wantMeta }))");
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", probe], {
      cwd: import.meta.dirname,
      env: { ...process.env, COOK_DATA_DIR: dd, COOK_EXTRACT_ICONS: "missing" },
      encoding: "utf-8",
    });
    assert.deepEqual(JSON.parse(out), [{ id: "0100000000DEF000", iconsOnly: false, wantMeta: true }]);
  } finally {
    rmSync(dd, { recursive: true, force: true });
  }
});
