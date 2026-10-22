import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  ADMIN_LANGS, CLIENT_LANGS, ROOT, compare, countsOf, dictionaryProblems, readCeilings, scanSource, scanTree,
} from "../../scripts/i18n-scan.mjs";

// Korean a person reads belongs in a dictionary with every language: ko en ja zh on admin and web
// pages, all twelve client languages for text a console shows. The panels written before this rule
// are Korean only; test/fixtures/i18n-ceilings.json holds their counts so they only go down.

const FIXTURES = path.join(import.meta.dirname, "../fixtures/i18n");
const scanFixture = (name) => scanSource(readFileSync(path.join(FIXTURES, name), "utf-8"), name);

test("Korean outside a dictionary is counted; comments, regexes, keys and dictionaries are not", () => {
  const { strays, dicts } = scanFixture("stray.js");
  assert.deepEqual(strays.map((s) => s.line), [3, 7, 9, 12]);
  assert.equal(strays[0].text, "저장하지 못했습니다");
  assert.equal(strays[3].text, "${…}개");
  assert.equal(dicts.length, 1);
  assert.deepEqual(dictionaryProblems(dicts[0]), []);
});

test("an HTML page counts its text and attributes, and reads its scripts as code", () => {
  const { strays, dicts } = scanFixture("page.html");
  assert.deepEqual(strays.map((s) => s.line), [6, 7, 10]);
  assert.equal(dicts.length, 1);
});

test("a dictionary lacking a language or a key, or with an empty value or a dash, is broken", () => {
  const { dicts } = scanFixture("broken-dict.js");
  assert.equal(dicts.length, 2, "objects without Korean text are not dictionaries");
  const [admin, client] = dicts.map(dictionaryProblems);
  assert.ok(admin.includes("missing zh"), admin.join("; "));
  assert.ok(admin.includes("en lacks bye"), admin.join("; "));
  assert.ok(admin.includes("ja.hi is empty"), admin.join("; "));
  assert.ok(admin.includes("en.hi has a dash"), admin.join("; "));
  assert.equal(dicts[1].kind, "client", "a client-only language makes it a client dictionary");
  assert.equal(client.length, 1);
  assert.match(client[0], /^missing ja, zh, es, fr, de, it, pt, ru, nl$/);
});

test("the ratchet: a new file starts at 0, going over fails, dropping under asks to lower the ceiling", () => {
  const counts = countsOf([{ file: "src/new.js", ...scanFixture("stray.js") }]);
  assert.deepEqual(compare(counts, {}).over, [{ section: "strays", file: "src/new.js", n: 4, ceiling: 0 }]);
  assert.deepEqual(compare(counts, { strays: { "src/new.js": 4 } }), { over: [], under: [] });
  assert.deepEqual(compare(counts, { strays: { "src/new.js": 5 } }).under, [{ section: "strays", file: "src/new.js", n: 4, ceiling: 5 }]);
});

// Lines this branch changed in a file, so a failure names the new strings rather than the whole backlog.
function changedLines(file) {
  try {
    const diff = execFileSync("git", ["diff", "-U0", "--merge-base", "origin/main", "--", file], { cwd: ROOT, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });
    const lines = new Set();
    for (const [, start, len] of diff.matchAll(/^@@ -\S+ \+(\d+)(?:,(\d+))? @@/gm)) {
      for (let i = 0; i < Number(len ?? 1); i++) lines.add(Number(start) + i);
    }
    return lines;
  } catch {
    return null;
  }
}

const results = scanTree();
const byFile = new Map(results.map((r) => [r.file, r]));
const { over, under } = compare(countsOf(results), readCeilings());

test("no file has more Korean outside dictionaries, or more broken dictionaries, than its ceiling", () => {
  const report = over.map(({ section, file, n, ceiling }) => {
    const r = byFile.get(file);
    if (section === "dictionaries") {
      const broken = r.dicts.filter((d) => dictionaryProblems(d).length);
      return `${file}: ${n} broken dictionaries, ceiling ${ceiling}\n` + broken.map((d) => `  ${file}:${d.line} ${dictionaryProblems(d).join("; ")}`).join("\n");
    }
    const changed = changedLines(file);
    const fresh = changed?.size ? r.strays.filter((s) => changed.has(s.line)) : r.strays;
    const shown = (fresh.length ? fresh : r.strays).slice(0, 40);
    return `${file}: ${n} Korean strings outside a dictionary, ceiling ${ceiling}\n` + shown.map((s) => `  ${file}:${s.line} ${s.text}`).join("\n");
  });
  assert.equal(over.length, 0, "Put new text in a dictionary with all its languages (ko en ja zh for admin, the twelve for clients):\n" + report.join("\n"));
});

test("a ceiling above its file's count is lowered, so the backlog only shrinks", () => {
  const report = under.map(({ section, file, n, ceiling }) => `  ${section} ${file}: ${n}, ceiling ${ceiling}`);
  assert.equal(under.length, 0, "Lower the ceiling: run `node scripts/i18n-scan.mjs --lower` and commit test/fixtures/i18n-ceilings.json\n" + report.join("\n"));
});

test("the scanner finds the known dictionaries and holds each to its languages", () => {
  const dictsOf = (file) => byFile.get(file)?.dicts ?? [];
  const top = dictsOf("src/routes/admin/top-i18n.js").find((d) => d.langs.get("ko")?.size > 100);
  assert.ok(top, "TOP_WORDS is found");
  assert.deepEqual([...top.langs.keys()].sort(), [...ADMIN_LANGS].sort());
  for (const file of ["src/routes/device-pair-text.js", "src/routes/ra-link-text.js", "src/views/landing.html"]) {
    assert.ok(dictsOf(file).some((d) => d.kind === "admin"), file);
  }
  const labels = dictsOf("src/meta/card-labels.js");
  assert.ok(labels.length >= 10 && labels.every((d) => d.kind === "client" && d.langs.size === CLIENT_LANGS.length));
});
