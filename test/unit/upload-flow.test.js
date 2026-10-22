import { test } from "node:test";
import assert from "node:assert/strict";
import { failureKind, hasBatches, splitUnits, tally, tallyFiles, trimHistory, unitsToSend } from "../../src/routes/admin/upload-flow.js";
import { TOP_LANGS, TOP_WORDS } from "../../src/routes/admin/top-i18n.js";
import { DASHBOARD_SCRIPT } from "../../src/routes/admin/dashboard-script.js";
import { dashboardPage } from "../../src/routes/admin/dashboard-page.js";

test("packages go one request each, so one bad file cannot take the others down", () => {
  const units = splitUnits({ kind: "game", names: ["a.nsp", "b.nsp", "c.xci"] });
  assert.deepEqual(units.map((u) => u.from), [[0], [1], [2]]);
  assert.deepEqual(units.map((u) => u.label), ["a.nsp", "b.nsp", "c.xci"]);
});

test("a folder, a ROM set and a lone file are each one request", () => {
  assert.deepEqual(splitUnits({ kind: "game", names: ["a.nsp"] }), [{ label: "a.nsp", from: [0] }]);
  assert.deepEqual(splitUnits({ kind: "retro", names: ["g.cue", "g.bin"] }), [{ label: "g.cue +1", from: [0, 1] }]);
  const folder = splitUnits({ kind: "save", names: ["x.dat", "y.dat"], paths: ["MK8 save/x.dat", "MK8 save/sub/y.dat"] });
  assert.deepEqual(folder, [{ label: "MK8 save/ · 2", from: [0, 1] }]);
  assert.deepEqual(splitUnits({ kind: "game", names: [] }), []);
});

test("packages picked as a folder still go one request each, so the server's one-package rule holds", () => {
  const units = splitUnits({ kind: "game", names: ["a.nsp", "b.nsp", "c.nsp"], paths: ["d/a.nsp", "d/b.nsp", "d/c.nsp"] });
  assert.deepEqual(units.map((u) => u.from), [[0], [1], [2]]);
  assert.deepEqual(units.map((u) => u.label), ["a.nsp", "b.nsp", "c.nsp"]);
  assert.equal(splitUnits({ kind: "save", names: ["a", "b"], paths: ["d/a", "d/b"] }).length, 1, "other kinds keep a folder whole");
});

test("the page script sends package units without folder paths and clears the old batch when entered from an app card", () => {
  assert.match(DASHBOARD_SCRIPT, /paths:upPaths&&upKind!=='game'/);
  const enter = DASHBOARD_SCRIPT.slice(DASHBOARD_SCRIPT.indexOf("if(upPending){"), DASHBOARD_SCRIPT.indexOf("upPreset=true"));
  for (const part of ["upFiles=[]", "upUnits=[]", "upGuess=null"]) assert.ok(enter.includes(part), part);
  assert.match(DASHBOARD_SCRIPT, /upPreset&&n&&mm/, "the mismatch warning stays on the app card entry");
});

test("a retry sends only what has not gone in", () => {
  const units = [{ state: "ok" }, { state: "fail" }, { state: "wait" }, { state: "ok" }];
  assert.deepEqual(unitsToSend(units).map((u) => u.state), ["fail", "wait"]);
  assert.deepEqual(unitsToSend([{ state: "ok" }]), [], "nothing left once all went in");
});

test("the tally separates sent, failed and still waiting", () => {
  assert.deepEqual(tally([{ state: "ok" }, { state: "ok" }, { state: "fail" }, { state: "busy" }, { state: "wait" }]), { ok: 2, fail: 1, wait: 2 });
  assert.deepEqual(tally([]), { ok: 0, fail: 0, wait: 0 });
});

test("failures are told apart: a taken name, no answer, anything else", () => {
  assert.equal(failureKind(409, "이미 있습니다: A.nsp"), "dup");
  assert.equal(failureKind(409, "읽기 전용입니다"), null, "another 409 shows the server's own words");
  assert.equal(failureKind(0, ""), "net");
  assert.equal(failureKind(413, "too big"), null);
});

test("a retry keeps what went up: the second pass sends the failed units only", () => {
  const units = splitUnits({ kind: "game", names: ["a.nsp", "b.nsp", "c.nsp"] }).map((u) => ({ ...u, state: "wait" }));
  const sent = [];
  const pass = (fails) => { for (const u of unitsToSend(units)) { sent.push(u.label); u.state = fails.includes(u.label) ? "fail" : "ok"; } };
  pass(["b.nsp"]);
  pass([]);
  assert.deepEqual(sent, ["a.nsp", "b.nsp", "c.nsp", "b.nsp"], "a.nsp and c.nsp are not sent again");
  assert.deepEqual(tally(units), { ok: 3, fail: 0, wait: 0 });
});

const holes = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

test("every upload string the page script asks for exists in all four languages with the same placeholders", () => {
  const keys = new Set([...DASHBOARD_SCRIPT.matchAll(/upT\('(\w+)'/g)].map((m) => m[1]));
  // Keys built from a table in the script: every kind needs its name, hint and plan.
  for (const kind of ["Game", "Patch", "Save", "Homebrew", "Port", "Client", "Retro"]) keys.add(`k${kind}`);
  for (const k of ["sumB", "sumBWait", "rList", "rUnit"]) keys.add(k);
  for (const k of ["hGame", "hRetro", "hPatch", "hSave", "hHomebrew", "hClient", "hPort", "pHomebrew", "pPort", "pClient"]) keys.add(k);
  assert.ok(keys.size > 30);
  for (const key of keys) {
    assert.ok(`u.${key}` in TOP_WORDS.ko, `u.${key} is missing from ko`);
    for (const [code] of TOP_LANGS) {
      assert.ok(TOP_WORDS[code][`u.${key}`], `u.${key} is missing from ${code}`);
      assert.equal(holes(TOP_WORDS[code][`u.${key}`]), holes(TOP_WORDS.ko[`u.${key}`]), `u.${key} placeholders differ in ${code}`);
    }
  }
});

test("the upload page opens on the file chooser with no kind or console list before a file is picked", () => {
  const html = dashboardPage();
  const page = html.slice(html.indexOf('<section id="tab-upload"'), html.indexOf("</section>", html.indexOf('<section id="tab-upload"')));
  assert.ok(page.indexOf('id="up-drop"') < page.indexOf('id="up-kinds"'), "the chooser comes before the kinds");
  assert.match(page, /<div id="up-kinds"[^>]*hidden>/, "the kinds start hidden");
  assert.match(page, /<div id="up-systems-wrap" hidden>/, "the consoles start hidden");
});

test("the page promises no incoming handoff and says homebrew and the client build are replaced", () => {
  for (const [code] of TOP_LANGS) {
    const all = Object.entries(TOP_WORDS[code]).filter(([k]) => k.startsWith("u.")).map(([, v]) => v).join("\n");
    assert.ok(!/incoming|인테이크|待ち受け/i.test(all), `${code} mentions incoming`);
  }
  assert.match(TOP_WORDS.ko["u.pHomebrew"], /바꿉니다/);
  assert.match(TOP_WORDS.ko["u.pClient"], /바꿉니다/);
});

test("the history cap never drops the batch on screen or its failures, only older rows", () => {
  const old = Array.from({ length: 10 }, (_, i) => ({ id: `old${i}`, state: "ok" }));
  const current = Array.from({ length: 51 }, (_, i) => ({ id: `cur${i}`, state: i === 0 ? "fail" : "ok" }));
  const history = [...old, ...current];
  const drop = trimHistory(history, current, 50);
  assert.deepEqual(drop.map((u) => u.id), old.map((u) => u.id), "only past rows go, even though the current batch alone is over the cap");
  assert.ok(!drop.includes(current[0]), "the failed row of the batch stays");
  assert.deepEqual(trimHistory(old, [], 50), [], "under the cap nothing goes");
  assert.deepEqual(trimHistory(Array.from({ length: 53 }, (_, i) => ({ i })), [], 50).map((u) => u.i), [0, 1, 2], "the oldest go first");
});

test("batch counts are told in files too, and only when a request holds several files", () => {
  const folder = [{ state: "ok", files: [1, 2] }, { state: "fail", files: [1, 2, 3] }, { state: "ok", files: [1] }];
  assert.equal(hasBatches(folder), true);
  assert.deepEqual(tally(folder), { ok: 2, fail: 1, wait: 0 });
  assert.deepEqual(tallyFiles(folder), { ok: 3, fail: 3, wait: 0 });
  assert.equal(hasBatches([{ state: "ok", files: [1] }, { state: "ok", files: [1] }]), false, "one file per request reads as files");
});

test("each request freezes where it goes, the controls lock while sending, and a finished summary is kept for a language switch", () => {
  assert.match(DASHBOARD_SCRIPT, /f:\{kind:upKind,system:\$\('up-system'\)\.value,app:\$\('up-target'\)\.value,titleId:upTitleId\(\)\}/);
  const send = DASHBOARD_SCRIPT.slice(DASHBOARD_SCRIPT.indexOf("function upSend("), DASHBOARD_SCRIPT.indexOf("async function upSubmit"));
  assert.ok(!/upKind/.test(send), "a request never reads the live kind");
  assert.ok(!/\$\('up-system'\)|\$\('up-target'\)/.test(send), "nor the live console or target");
  assert.match(DASHBOARD_SCRIPT, /#up-kinds button,#up-change,#up-file-btn,#up-dir-btn'\)\)b\.disabled=upBusy/);
  assert.match(DASHBOARD_SCRIPT, /const shown=upUnits\.length\?upUnits:upDone/);
});

test("the batch wording is in all four languages with the file counts", () => {
  for (const [code] of TOP_LANGS) for (const k of ["sumB", "sumBWait", "rList", "rUnit"]) assert.ok(TOP_WORDS[code][`u.${k}`], `${code} u.${k}`);
  assert.equal(holes(TOP_WORDS.en["u.sumB"]), "fail,failF,ok,okF");
});
