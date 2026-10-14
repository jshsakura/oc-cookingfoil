import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { classifySet, rankSets, reasonFor } from "../../src/retro/arcade-policy.js";

// Real sets from the FinalBurn Neo DAT the server ships.
const DAT = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "../../src/retro/data/fbneo-arcade.json"), "utf8")).sets;
const member = (short, runnable = true) => ({ short, desc: DAT[short][0], parent: !DAT[short][1], runnable });
const best = (shorts, runnable = {}) => rankSets(shorts.map((s) => member(s, runnable[s] ?? true)))[0].short;

test("a set's tags say its region, date, revision, quality and cabinet", () => {
  const rows = [
    ["knightsj", { region: "jp", date: 19911127, flags: [], hardware: [] }],
    ["gunbird", { region: "world", date: null, flags: [], hardware: [] }],
    ["gunbirdk", { region: "kr", translation: false }],
    ["gunbirdka", { region: "kr", translation: true }],
    ["kof2000", { region: null, hardware: ["mvs"] }],
    ["kof2000n", { flags: ["decrypted"] }],
    ["kof97h", { hardware: ["aes"] }],
    ["daimakair", { region: "jp", hardware: ["resale"] }],
    ["kodda", { region: "world", date: 19910731, flags: ["bootleg"] }],
    ["ffightae", { region: "world", flags: ["hack"] }],
    ["kodbs", { flags: ["hack"] }],
    ["99lstwara", { set: 2 }],
    ["sfzch", { region: "jp", hardware: ["cps-changer"] }],
    ["tengaij", { region: "world" }],
  ];
  for (const [short, want] of rows) {
    const got = classifySet(DAT[short][0]);
    for (const [k, v] of Object.entries(want)) assert.deepEqual(got[k], v, `${short} ${k}`);
  }
});

test("the representative follows Korea, then World, USA, Europe, Japan, and never a hack or bootleg", () => {
  const cases = [
    [["gunbird", "gunbirdj"], "gunbird"],
    [["gunbird", "gunbirdj", "gunbirdka"], "gunbirdka"],
    [["gunbirdka", "gunbirdk"], "gunbirdk"], // a Korean release before a translation
    [["knights", "knightsj", "knightsu"], "knights"],
    [["knightsj", "knightsu"], "knightsu"],
    [["kod", "kodj", "kodr1", "kodr2"], "kod"], // the newest World revision
    [["kodr1", "kodr2", "kodda"], "kodr2"], // newer, but a bootleg
    [["kof2000", "kof2000n"], "kof2000"],
    [["daimakai", "daimakair"], "daimakai"],
    [["ghouls", "daimakai", "daimakair"], "ghouls"],
    [["1941", "1941r1", "1941j"], "1941"],
    [["99lstwar", "99lstwara", "99lstwarb"], "99lstwar"],
    [["ffight", "ffightae", "ffightj"], "ffight"],
    [["ffightae"], "ffightae"], // the only set, hack or not
    [["ddsomkd", "ddsom"], "ddsom"], // a Korean bootleg is still a bootleg
    [["ddsom", "ddsomu", "ddsomj"], "ddsomu"],
  ];
  for (const [shorts, want] of cases) assert.equal(best(shorts), want, shorts.join(","));
});

test("only a set whose main region is Korea is Korean; content tags and older versions lose", () => {
  const cls = (desc) => classifySet(desc);
  assert.equal(cls("Some Game (Korea?)").region, null, "an uncertain region is no region");
  assert.equal(cls(DAT.aerofgt[0]).region, "world", "a list of regions counts its first");
  assert.equal(cls("Cookie & Bibi 2 (English / Korean)").region, null, "languages are not a release region");
  assert.equal(cls("Air Gallet (older, Korea)").older, true);
  const rank = (descs) => rankSets(descs.map((desc, i) => ({ short: `s${i}`, desc, parent: i === 0, runnable: true })))[0].desc;
  assert.equal(rank(["Game (World / Korea)", "Game (USA)"]), "Game (World / Korea)", "World first, not Korean");
  assert.equal(rank(["Game (Korea?)", "Game (USA)"]), "Game (USA)");
  assert.equal(rank(["Game (Japan, adult)", "Game (Japan)"]), "Game (Japan)");
  assert.equal(rank(["Air Gallet (older, Europe)", "Air Gallet (Europe)"]), "Air Gallet (Europe)", "the parent is the older one here");
});

test("a set that cannot run loses to one that can", () => {
  assert.equal(best(["gunbird", "gunbirdk"], { gunbirdk: false }), "gunbird");
  assert.equal(best(["knightsj", "knights"], { knights: false }), "knightsj");
});

test("the reason says why the representative leads", () => {
  const reason = (shorts, runnable = {}) => reasonFor(rankSets(shorts.map((s) => member(s, runnable[s] ?? true))));
  assert.equal(reason(["gunbird"]), "하나뿐인 세트입니다");
  assert.equal(reason(["gunbird", "gunbirdj"]), "해외판입니다");
  assert.equal(reason(["kodr1", "kod"]), "해외판 최신 개정입니다");
  assert.equal(reason(["gunbirdk", "gunbird"]), "한국판입니다");
  assert.equal(reason(["ffightae", "ffightbl"]), "정규 세트가 없어 비정규 세트를 씁니다");
  assert.equal(reason(["gunbirdj", "gunbird"], { gunbirdj: false, gunbird: false }), "돌아가는 세트가 없습니다");
});
