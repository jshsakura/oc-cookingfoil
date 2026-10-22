import { test } from "node:test";
import assert from "node:assert/strict";
import { failureKind, splitUnits, tally, unitsToSend } from "../../src/routes/admin/upload-flow.js";
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
