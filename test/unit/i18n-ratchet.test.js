import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  ADMIN_LANGS, CEILINGS_FILE, CLIENT_LANGS, ROOT, baseRef, compare, countsOf, dataLiteralProblems, dictionaryProblems,
  describeNew, lowerCeilings, newExemptions, newSince, readCeilings, readDataLiterals, readDataLiteralsAt, renameHints, scanEntries,
  scanRef, scanSource, scanTree,
} from "../../scripts/i18n-scan.mjs";

// Korean a person reads belongs in a dictionary with every language: ko en ja zh on admin and web
// pages, all twelve client languages for text a console shows. The panels written before this rule
// are Korean only; test/fixtures/i18n-ceilings.json holds their counts so they only go down, and
// against the merge base with origin/main no file may gain a Korean string it did not have.

const FIXTURES = path.join(import.meta.dirname, "../fixtures/i18n");
const fixture = (name) => readFileSync(path.join(FIXTURES, name), "utf-8");
const scanFixture = (name, options) => scanSource(fixture(name), name, options);

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

test("each problem in a dictionary counts on its own: a missing language, a missing key, an empty value, a dash", () => {
  const { dicts, problems } = scanFixture("broken-dict.js");
  assert.equal(dicts.length, 2, "objects without Korean text are not dictionaries");
  const [admin, client] = dicts.map(dictionaryProblems);
  for (const p of ["missing zh", "en lacks bye", "ja.hi is empty", "en.hi has a dash"]) assert.ok(admin.includes(p), admin.join("; "));
  assert.equal(dicts[1].kind, "client", "a client-only language makes it a client dictionary");
  assert.deepEqual(client, ["ja", "zh", "es", "fr", "de", "it", "pt", "ru", "nl"].map((l) => `missing ${l}`));
  assert.equal(problems.length, admin.length + client.length);
  assert.ok(problems.every((p) => p.key.startsWith("ADMIN: ") || p.key.startsWith("CLIENT: ")), "a problem is named by its dictionary");
});

test("a key added to ko alone in a dictionary that is already broken goes over the ceiling", () => {
  const source = fixture("broken-dict.js");
  const before = countsOf([{ file: "src/x.js", ...scanSource(source, "src/x.js") }]);
  const after = countsOf([{ file: "src/x.js", ...scanSource(source.replace('bye: "안녕히 가세요"', 'bye: "안녕히 가세요", fresh: "새 문구"'), "src/x.js") }]);
  assert.ok(after.problems["src/x.js"] > before.problems["src/x.js"]);
  assert.equal(compare(after, before).over.length, 1);
});

test("properties beside the languages in a dictionary are read like any other code", () => {
  const { strays, problems } = scanFixture("sibling.js");
  assert.deepEqual(strays.map((s) => s.text), ["사전 옆에 숨긴 문구", "메서드 안의 문구"]);
  assert.deepEqual(problems, []);
});

test("a translation left in Korean, or copied from ko, is a missing translation", () => {
  const { dicts } = scanFixture("copied.js");
  const [admin, client] = dicts.map(dictionaryProblems);
  assert.deepEqual(admin, ["ja.save copies ko", "zh.open is Korean"]);
  assert.deepEqual(client, ["es copies ko"]);
  assert.equal(dicts.length, 2, "the language menu names Korean in Korean in every language");
});

test("against the base, a new Korean string fails even when another one went away", () => {
  const base = scanEntries([{ file: "src/a.js", source: 'export const a = ["저장합니다", "열었습니다"];' }]);
  const swapped = scanEntries([{ file: "src/a.js", source: 'export const a = ["저장합니다", "새 문구입니다"];' }]);
  assert.deepEqual(compare(countsOf(swapped), countsOf(base)).over, [], "the count alone does not see a swap");
  assert.deepEqual(newSince(swapped, base).map((n) => `${n.file}:${n.line} ${n.text}`), ["src/a.js:1 새 문구입니다"]);
  const twice = scanEntries([{ file: "src/a.js", source: 'export const a = ["저장합니다", "저장합니다"];' }]);
  assert.deepEqual(newSince(twice, base).map((n) => n.text), ["저장합니다"], "a second copy is a new string too");
});

test("against the base, text moved to another file or reformatted in HTML is not new", () => {
  const base = scanEntries([{ file: "src/a.js", source: 'export const a = "저장합니다";\nexport const h = `<h3 class="x">코어</h3>`;' }]);
  const moved = scanEntries([
    { file: "src/a.js", source: 'export const h = `<h3 class="y" data-x="1">코어</h3>`;' },
    { file: "src/b.js", source: 'export const a = "저장합니다";' },
  ]);
  assert.deepEqual(newSince(moved, base), []);
  const added = scanEntries([{ file: "src/a.js", source: 'export const a = "저장합니다";\nexport const h = `<h3>코어</h3><button>받기</button>`;' }]);
  assert.deepEqual(newSince(added, base).map((n) => n.text), ["코어 · 받기"], "a button added to a counted HTML line is new");
});

test("against the base, a new problem in a dictionary fails even when another was fixed", () => {
  const base = scanEntries([{ file: "src/a.js", source: 'export const W = { ko: { a: "가", b: "나" }, en: { a: "A – x", b: "B" }, ja: { a: "あ", b: "い" }, zh: { a: "甲", b: "乙" } };' }]);
  const swapped = scanEntries([{ file: "src/a.js", source: 'export const W = { ko: { a: "가", b: "나", c: "다" }, en: { a: "A", b: "B" }, ja: { a: "あ", b: "い", c: "う" }, zh: { a: "甲", b: "乙", c: "丙" } };' }]);
  assert.deepEqual(compare(countsOf(swapped), countsOf(base)).over, []);
  assert.deepEqual(newSince(swapped, base).map((n) => n.text), ["W: en lacks c"], "named by its dictionary");
});

test("a markdown doc counts its Korean lines until every admin language has the same document", () => {
  const ko = "# 안내\n\n첫 줄입니다.\n\n## 둘\n\n- 항목\n";
  const en = "# Guide\n\nFirst line.\n\n## Two\n\n- Item\n";
  const alone = scanEntries([{ file: "src/views/guide.md", source: ko }]);
  assert.deepEqual(alone[0].strays.map((s) => s.line), [1, 3, 5, 7]);
  assert.deepEqual(alone[0].problems, []);
  const guide = (results) => results.find((r) => r.file === "src/views/guide.md");
  const partial = scanEntries([{ file: "src/views/guide.md", source: ko }, { file: "src/views/guide.en.md", source: en }]);
  assert.equal(guide(partial).strays.length, 4, "the Korean still counts while a language is missing");
  assert.deepEqual(guide(partial).problems.map((p) => p.text), ["missing ja", "missing zh"]);
  const whole = scanEntries(["", ".en", ".ja", ".zh"].map((l, i) => ({ file: `src/views/guide${l}.md`, source: i ? en : ko })));
  assert.deepEqual(whole.flatMap((r) => [...r.strays, ...r.problems]), [], "a translated doc is a dictionary of documents");
  const longer = scanEntries(["", ".en", ".ja", ".zh"].map((l, i) => ({ file: `src/views/guide${l}.md`, source: i ? en : ko + "\n새 줄입니다.\n" })));
  assert.deepEqual(guide(longer).problems.map((p) => p.text), ["en has 4 lines, ko 5", "ja has 4 lines, ko 5", "zh has 4 lines, ko 5"]);
  const korean = scanEntries(["", ".en", ".ja", ".zh"].map((l, i) => ({ file: `src/views/guide${l}.md`, source: i === 2 ? ko : i ? en : ko })));
  assert.equal(korean.find((r) => r.file === "src/views/guide.ja.md").strays.length, 4, "Korean in a translation counts");
});

test("a renamed or split file: the failure says how to move the ceiling, and --rename moves it without raising it", () => {
  const ceilings = { strays: { "src/old.js": 10 }, problems: {} };
  const counts = { strays: { "src/a.js": 6, "src/b.js": 3 }, problems: {} };
  const hints = renameHints(counts, ceilings, new Set(["src/a.js", "src/b.js"]));
  assert.deepEqual(hints, ["node scripts/i18n-scan.mjs --lower --rename src/old.js src/a.js --rename src/old.js src/b.js"]);
  const moved = lowerCeilings(ceilings, counts, [["src/old.js", "src/a.js"], ["src/old.js", "src/b.js"]]);
  assert.deepEqual(moved, { strays: { "src/a.js": 6, "src/b.js": 3 }, problems: {} });
  const greedy = lowerCeilings(ceilings, { strays: { "src/a.js": 8, "src/b.js": 5 }, problems: {} }, [["src/old.js", "src/a.js"], ["src/old.js", "src/b.js"]]);
  assert.deepEqual(greedy.strays, { "src/a.js": 8, "src/b.js": 2 }, "a rename never hands out more than the old ceiling");
  const kept = lowerCeilings({ strays: { "src/old.js": 10 } }, { strays: { "src/old.js": 7, "src/a.js": 5 } }, [["src/old.js", "src/a.js"]]);
  assert.deepEqual(kept.strays, { "src/a.js": 3, "src/old.js": 7 }, "a split keeps what stays behind");
});

test("data literals are exempt only by file and exact text or constant, each with a reason, and none goes stale", () => {
  const exempt = [
    { file: "data-literals.js", constant: "ALIASES", reason: "matching table" },
    { file: "data-literals.js", literal: "한국판", reason: "edition marker" },
    { file: "data-literals.js", literal: "정발", reason: "edition marker" },
  ];
  const r = scanFixture("data-literals.js", { exempt });
  assert.deepEqual(r.strays.map((s) => s.text), ["북미판", "한글"]);
  assert.equal(r.used.size, 3);
  const results = [{ file: "data-literals.js", ...r }];
  assert.deepEqual(dataLiteralProblems(exempt, results), []);
  const bad = [...exempt, { file: "data-literals.js", literal: "없는 문구", reason: "x" }, { file: "data-literals.js", literal: "북미판" }, { file: "data-literals.js", reason: "y" }];
  const checked = scanFixture("data-literals.js", { exempt: bad });
  assert.deepEqual(dataLiteralProblems(bad, [{ file: "data-literals.js", ...checked }]), [
    "data-literals.js 없는 문구: matches nothing",
    "data-literals.js 북미판: needs a reason",
    "data-literals.js: needs one of literal or constant",
  ]);
});

test("a constant exemption covers only a top-level table of plain strings, never code or a nested name", () => {
  const exempt = [{ file: "src/a.js", constant: "ALIASES", reason: "matching table" }];
  const nested = scanEntries([{ file: "src/a.js", source: 'const ALIASES = { Party: ["가족"] };\nexport function msg() { const ALIASES = "함수 안에 숨긴 새 오류 문구입니다"; return ALIASES; }\n' }], exempt);
  assert.deepEqual(nested[0].strays.map((s) => s.text), ["함수 안에 숨긴 새 오류 문구입니다"], "the same name inside a function is not the table");
  assert.deepEqual(dataLiteralProblems(exempt, nested), ["src/a.js ALIASES: line 2 is not a top-level table of plain strings"]);
  const script = [{ file: "src/s.js", constant: "DASHBOARD_SCRIPT", reason: "inlined script" }];
  const whole = scanEntries([{ file: "src/s.js", source: "export const DASHBOARD_SCRIPT = `const NEWMSG='새로 숨긴 관리자 문구입니다';`;\n" }], script);
  assert.deepEqual(whole[0].strays.map((s) => s.text), ["새로 숨긴 관리자 문구입니다"], "a template is code, not a table");
  assert.deepEqual(dataLiteralProblems(script, whole), ["src/s.js DASHBOARD_SCRIPT: line 1 is not a top-level table of plain strings"]);
  const fn = [{ file: "src/f.js", constant: "T", reason: "x" }];
  const withFn = scanEntries([{ file: "src/f.js", source: 'export const T = { a: ["가"], b: () => "함수 문구" };\n' }], fn);
  assert.equal(withFn[0].strays.length, 2, "a function in the table makes it code");
  const table = scanEntries([{ file: "src/a.js", source: 'export const ALIASES = { Party: ["가족", "family"], Training: ["피트니스"] };\n' }], exempt);
  assert.deepEqual(table[0].strays, []);
  assert.equal(table[0].used.get(exempt[0]), 2, "the exemption knows how many strings it hides");
});

test("an exemption the merge base did not have fails until approved, naming the entry and what it hides", () => {
  const source = 'export const X = "새 관리자 알림 문구입니다";\nexport const ALIASES = { a: ["가족", "피트니스"] };\n';
  const head = [
    { file: "src/alerts.js", literal: "새 관리자 알림 문구입니다", reason: "data" },
    { file: "src/alerts.js", constant: "ALIASES", reason: "matching table" },
  ];
  const results = scanEntries([{ file: "src/alerts.js", source }], head);
  assert.deepEqual(results[0].strays, [], "the same PR hid the string");
  assert.deepEqual(newExemptions(head, [], results), [
    "src/alerts.js literal 새 관리자 알림 문구입니다: new since the merge base, hides 1 string",
    "src/alerts.js constant ALIASES: new since the merge base, hides 2 strings",
  ]);
  assert.deepEqual(newExemptions(head, [head[1]], results).length, 1, "an entry the base had is not new");
  const approved = head.map((e) => ({ ...e, approved: "reviewer in PR #1" }));
  assert.deepEqual(newExemptions(approved, [], results), []);
  assert.deepEqual(newExemptions(head.map((e) => ({ ...e, approved: " " })), [], results).length, 2, "a blank approval is none");
  const base = scanEntries([{ file: "src/alerts.js", source }], []);
  assert.equal(base[0].strays.length, 3, "the base side is scanned with the base's own list, so the hidden strings show");
});

test("a translated guide passes only when each line is translated, not filled with placeholders", () => {
  const ko = "# 안내\n\n첫 줄입니다.\n\n## 둘\n\n- 항목\n\n```\nnpm start\n```\n";
  const en = "# Guide\n\nFirst line.\n\n## Two\n\n- Item\n\n```\nnpm start\n```\n";
  const set = (tr) => scanEntries(["", ".en", ".ja", ".zh"].map((l, i) => ({ file: `src/views/guide${l}.md`, source: i ? tr(l.slice(1)) : ko })));
  const guide = (results) => results.find((r) => r.file === "src/views/guide.md");
  assert.deepEqual(guide(set(() => en)).problems, [], "a real translation with an identical code line passes");
  const todo = ko.split("\n").map((l) => (!l.trim() ? "" : /^#{1,6}\s/.test(l) ? l.match(/^#+/)[0] + " x" : "TODO")).join("\n");
  const filler = set(() => todo);
  assert.ok(guide(filler).strays.length > 0, "the Korean still counts");
  assert.ok(guide(filler).problems.some((p) => p.text.startsWith("en has placeholder lines")), guide(filler).problems.map((p) => p.text).join("; "));
  const copied = set(() => en.replace("First line.", "첫 줄입니다."));
  assert.ok(guide(copied).problems.some((p) => p.text.startsWith("en copies ko at line 3")), guide(copied).problems.map((p) => p.text).join("; "));
  const hangul = set(() => en.replace("First line.", "First 줄."));
  assert.ok(guide(hangul).problems.some((p) => p.text.startsWith("en has Korean at line 3")), guide(hangul).problems.map((p) => p.text).join("; "));
});

test("a broken dictionary renamed without a change says so instead of looking like new problems", () => {
  const dict = (name) => `export const ${name} = { ko: { a: "가" }, en: { a: "A" } };`;
  const base = scanEntries([{ file: "src/a.js", source: dict("SOURCE_LABEL") }]);
  const head = scanEntries([{ file: "src/a.js", source: dict("SOURCE_LABEL_RENAMED") }]);
  const fresh = newSince(head, base);
  assert.deepEqual(fresh.map((f) => f.text), ["SOURCE_LABEL_RENAMED: missing ja", "SOURCE_LABEL_RENAMED: missing zh"]);
  assert.match(describeNew(fresh[0]), /SOURCE_LABEL at the merge base had the same problem: the dictionary was renamed/);
});

// ---- The tree itself ----

const exempt = readDataLiterals();
const results = scanTree(ROOT, exempt);
const byFile = new Map(results.map((r) => [r.file, r]));
const ceilings = readCeilings();
const counts = countsOf(results);
const { over, under } = compare(counts, ceilings);
const base = baseRef();
// The base is read with its own exemptions, so text this branch exempts shows as gone, not as never there.
const baseExempt = base ? readDataLiteralsAt(base) : [];
const baseResults = base ? scanRef(base, baseExempt) : null;
const fresh = baseResults ? newSince(results, baseResults) : null;
const NO_BASE = "No merge base with origin/main (a shallow clone?): only the per-file counts were compared, so a string swapped for another is not caught here.";
const hints = renameHints(counts, ceilings, new Set(results.map((r) => r.file)));
const RENAME = hints.length ? `\nIf a file was renamed or split, move its ceiling instead of editing the JSON:\n  ${hints.join("\n  ")}` : "";

// Lines this branch changed in a file, to point at new strings when there is no base to compare with.
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

const HOW = "Put new text in a dictionary with all its languages (ko en ja zh for admin, the twelve for clients). "
  + "Admin page HTML uses ${top('key')} rather than Korean with a data-top attribute. "
  + "A top-level table of plain strings that holds Korean as data goes in test/fixtures/i18n-data-literals.json with its reason, "
  + "and a new entry needs an `approved` field from the reviewer.";

test("no file has more Korean outside dictionaries, or more dictionary problems, than its ceiling", () => {
  const report = over.map(({ section, file, n, ceiling }) => {
    const r = byFile.get(file);
    const items = section === "problems" ? r.problems : r.strays;
    const changed = fresh ? null : changedLines(file);
    const newer = fresh ? fresh.filter((f) => f.file === file && f.section === section) : items.filter((s) => changed?.has(s.line));
    const shown = (newer.length ? newer : items).slice(0, 40);
    const what = section === "problems" ? "dictionary problems" : "Korean strings outside a dictionary";
    return `${file}: ${n} ${what}, ceiling ${ceiling}\n` + shown.map((s) => `  ${s.section ? describeNew(s) : `${file}:${s.line} ${s.text}`}`).join("\n");
  });
  assert.equal(over.length, 0, `${HOW}\n${report.join("\n")}${RENAME}${base ? "" : `\n${NO_BASE}`}`);
});

test("no file gains a Korean string or a dictionary problem it did not have at the merge base", (t) => {
  if (!fresh) return t.diagnostic(NO_BASE);
  const report = fresh.map((f) => `  ${describeNew(f)}`);
  assert.equal(fresh.length, 0, `${HOW}\nNew since ${base.slice(0, 7)}:\n${report.join("\n")}`);
});

test("a ceiling above its file's count is lowered, so the backlog only shrinks", () => {
  const report = under.map(({ section, file, n, ceiling }) => `  ${section} ${file}: ${n}, ceiling ${ceiling}`);
  assert.equal(under.length, 0, "Lower the ceiling: run `node scripts/i18n-scan.mjs --lower` and commit test/fixtures/i18n-ceilings.json\n" + report.join("\n") + RENAME);
});

test("the ceilings in total never rise above the merge base's", (t) => {
  if (!base) return t.diagnostic(NO_BASE);
  let before;
  try {
    before = JSON.parse(execFileSync("git", ["show", `${base}:${path.relative(ROOT, CEILINGS_FILE)}`], { cwd: ROOT, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }));
  } catch {
    return t.diagnostic("The merge base has no ceilings file yet.");
  }
  const total = (c, section) => Object.values(c[section] ?? {}).reduce((a, b) => a + b, 0);
  for (const section of Object.keys(ceilings)) {
    if (!(section in before)) continue;
    assert.ok(total(ceilings, section) <= total(before, section), `${section} ceilings add up to more than at ${base.slice(0, 7)}: a ceiling was raised by hand`);
  }
});

test("every data literal exemption has a reason and still matches something", () => {
  const problems = dataLiteralProblems(exempt, results);
  assert.deepEqual(problems, [], "Fix test/fixtures/i18n-data-literals.json:\n" + problems.join("\n"));
});

test("no data literal exemption is new since the merge base without an approval", (t) => {
  if (!base) return t.diagnostic(NO_BASE);
  const added = newExemptions(exempt, baseExempt, results);
  assert.deepEqual(added, [], "An exemption takes its text out of the ratchet. Ask the reviewer, then record it as "
    + "\"approved\": \"<who, where>\" on the entry in test/fixtures/i18n-data-literals.json, or translate the text instead:\n  " + added.join("\n  "));
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
  assert.equal(ceilings.problems?.["src/views/landing.html"] ?? 0, 0, "the web page people see first has a whole dictionary");
  assert.ok(byFile.get("src/views/guide.md")?.strays.length > 0, "the operator guide is read as text");
});
