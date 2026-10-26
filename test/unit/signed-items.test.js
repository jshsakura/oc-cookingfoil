import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

// Whether a file is signed reaches the sections items (feature "item-signed") and the title detail,
// only for files the check knows about, with the help only when something is unsigned.

const PROBE = `
  import { composeSections } from "../../src/create-index-content.js";
  import * as fileIntegrity from "../../src/meta/file-integrity.js";
  import { signedFor } from "../../src/meta/title-detail.js";
  const signed = {
    "Mario [0100000000010000][v0].nsp": { nca: false, ticket: true },
    "Mario Update [0100000000010800][v65536].nsp": { nca: true, ticket: true },
  };
  fileIntegrity.provideSigned((rel) => signed[rel] ?? null);
  const filesMap = new Map([
    ["Mario [0100000000010000][v0].nsp", { url: "../Mario.nsp", name: "Mario [0100000000010000][v0]", size: 1 }],
    ["Mario Update [0100000000010800][v65536].nsp", { url: "../MarioU.nsp", name: "Mario [0100000000010800][v65536]", size: 1 }],
    ["Zelda [0100000000020000][v0].nsp", { url: "../Zelda.nsp", name: "Zelda [0100000000020000][v0]", size: 1 }],
  ]);
  const items = composeSections(filesMap, []).sections[0].items.map((i) => [i.title_id, i.signed ?? null]);
  const detail = signedFor("0100000000010000", "ko", [
    { rel: "Mario [0100000000010000][v0].nsp", kind: "base", titleId: "0100000000010000", baseTitleId: "0100000000010000" },
    { rel: "Mario Update [0100000000010800][v65536].nsp", kind: "update", titleId: "0100000000010800", baseTitleId: "0100000000010000" },
    { rel: "Mario DLC [0100000000011001][v0].nsp", kind: "dlc", titleId: "0100000000011001", baseTitleId: "0100000000010000" },
    { rel: "Zelda [0100000000020000][v0].nsp", kind: "base", titleId: "0100000000020000", baseTitleId: "0100000000020000" },
  ]);
  process.stdout.write(JSON.stringify({ items, detail }));
`;

function run() {
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", PROBE], {
    cwd: import.meta.dirname,
    env: { ...process.env, COOK_EXTRACT_ICONS: "off" },
    encoding: "utf-8",
  });
  return JSON.parse(out);
}

test("sections items carry signed only when the check knows", () => {
  const { items } = run();
  assert.deepEqual(items, [
    ["0100000000010000", { nca: false, ticket: true }],
    ["0100000000010800", { nca: true, ticket: true }],
    ["0100000000020000", null],
  ]);
});

test("the title detail lists every known file by name, with the help only on the unsigned one", () => {
  const { detail } = run();
  assert.deepEqual(detail.map((f) => [f.file, f.kind, f.nca, f.ticket, Boolean(f.help)]), [
    ["Mario [0100000000010000][v0].nsp", "base", false, true, true],
    ["Mario Update [0100000000010800][v65536].nsp", "update", true, true, false],
  ]);
  assert.equal(detail[0].help.title, "서명이 없는 파일", "help in the reader's language");
  assert.match(detail[0].help.body, /콘텐츠 서명/);
});
