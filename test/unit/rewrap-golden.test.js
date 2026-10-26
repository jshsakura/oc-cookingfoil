// The rewrap contract as a console sees it, over HTTP: bytes, lengths, ranges, ETags, refusals and shop info
// for a fixed set of synthetic games. The expected values live in test/fixtures/rewrap-golden.json and were
// taken from the rewrap that was built into the server; the same file must pass after rewrap moved into a
// plugin. Fixtures and keys are made from a seeded byte stream so the hashes are the same on every run.
// GOLDEN_UPDATE=1 rewrites the expectations (only for a change that is meant to alter the bytes).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import express from "express";
import {
  buildCnmt, buildMetaNca, buildNcz, buildProgramNca, buildTicket, keysUpTo, makeKeys, rightsIdFor,
} from "../support/rewrap-files.js";
import { buildPfs0, buildXci } from "../support/switch-files.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "rewrap-golden-"));
const keysFile = path.join(root, "prod.keys");
process.env.COOK_DATA_DIR = path.join(root, "data");
process.env.COOK_PROD_KEYS_PATH = keysFile;
const GOLDEN_FILE = path.join(import.meta.dirname, "../fixtures/rewrap-golden.json");
const UPDATE = process.env.GOLDEN_UPDATE === "1";
const LANGS = ["en", "ko", "ja", "zh", "zh-Hant", "es", "fr", "de", "it", "pt", "ru", "nl"];

const { systemVersionOf } = await import("../../src/meta/rewrap/generations.js");
const { largeFiles, GAME_FILE_RE } = await import("../../src/helpers/file-send.js");
const serve = await import("../../src/meta/rewrap/serve.js");
const { parsePfs0Header } = await import("../../src/meta/pfs0.js");

// ── the harness: the one place that knows how rewrap is wired into the server ──
const harness = {
  async start(games) {
    const app = express();
    app.use(largeFiles(games, GAME_FILE_RE));
    const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
    return { base: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
  },
  resetPlans: () => serve.clearPlans(),
};

// ── deterministic fixtures ──
const realRandomBytes = crypto.randomBytes;
let drawn = 0;
const seeded = (n) => {
  const out = Buffer.alloc(n);
  for (let at = 0; at < n; at += 32) crypto.createHash("sha256").update(`rewrap-golden:${drawn++}`).digest().copy(out, at);
  return out;
};
const v = (s) => systemVersionOf(s);
// 16 hex characters of the SHA-256: plenty to tell two byte streams apart, and short enough to read as a label.
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16);
const writeKeys = (keys) => fs.writeFileSync(keysFile, [...keys].map(([n, k]) => `${n} = ${k}`).join("\n") + "\n");

let K, shop, games;
const files = {};
const golden = { bytes: {}, ranges: {}, etags: {}, refusals: {}, languages: {}, shopInfo: {} };

function nsp(gen, rsv) {
  const program = buildProgramNca(K, gen);
  const meta = buildMetaNca(K, gen, buildCnmt({ requiredSystemVersion: v(rsv) }));
  return buildPfs0([{ name: "aaaa.nca", data: program.nca }, { name: "bbbb.cnmt.nca", data: meta.nca }]);
}

before(async () => {
  crypto.randomBytes = seeded;
  try {
    K = makeKeys(20);
    files["std.nsp"] = nsp(19, "20.1.0");
    files["low.nsp"] = nsp(12, "13.0.0");
    files["cnmt-only.nsp"] = nsp(15, "20.0.0");
    const rid = rightsIdFor(18);
    const meta18 = buildMetaNca(K, 18, buildCnmt({ requiredSystemVersion: v("19.0.0") }));
    files["titlekey.nsz"] = buildPfs0([
      { name: "aaaa.ncz", data: buildNcz(K, 18, { rightsId: rid }).ncz },
      { name: "bbbb.nca", data: buildProgramNca(K, 18, { rightsId: rid }).nca },
      { name: "cccc.cnmt.nca", data: meta18.nca },
      { name: `${rid.toString("hex")}.tik`, data: buildTicket(K, 18, rid, seeded(16)) },
      { name: `${rid.toString("hex")}.cert`, data: Buffer.alloc(0x700, 7) },
    ]);
    const rid19 = rightsIdFor(19);
    files["plain.nsz"] = buildPfs0([
      { name: "aaaa.ncz", data: buildNcz(K, 19).ncz },
      { name: "bbbb.cnmt.nca", data: buildMetaNca(K, 19, buildCnmt({ requiredSystemVersion: v("20.0.0") })).nca },
    ]);
    files["cart.xcz"] = buildXci([
      { name: "aaaa.ncz", data: buildNcz(K, 19).ncz },
      { name: "bbbb.cnmt.nca", data: buildMetaNca(K, 19, buildCnmt({ requiredSystemVersion: v("20.0.0") })).nca },
    ]);
    files["lone.nsp"] = buildPfs0([{ name: "a.nca", data: buildProgramNca(K, 19, { rightsId: rid19 }).nca }]);
    files["personal.nsp"] = buildPfs0([
      { name: "a.nca", data: buildProgramNca(K, 19, { rightsId: rid19 }).nca },
      { name: `${rid19.toString("hex")}.tik`, data: buildTicket(K, 19, rid19, seeded(16), { keyType: 1 }) },
    ]);
    files["junk.nsp"] = Buffer.alloc(0x100, 1);
  } finally {
    crypto.randomBytes = realRandomBytes;
  }
  games = path.join(root, "games");
  fs.mkdirSync(games, { recursive: true });
  for (const [name, data] of Object.entries(files)) fs.writeFileSync(path.join(games, name), data);
  writeKeys(K.keys);
  shop = await harness.start(games);
});

after(() => {
  shop?.close();
  fs.rmSync(root, { recursive: true, force: true });
  if (UPDATE) fs.writeFileSync(GOLDEN_FILE, `${JSON.stringify(golden, null, 2)}\n`);
});

const expected = () => JSON.parse(fs.readFileSync(GOLDEN_FILE, "utf8"));
/** Records `value` under golden[section][key] when updating; otherwise it must equal what was recorded. */
function pin(section, key, value) {
  golden[section][key] = value;
  if (!UPDATE) assert.deepEqual(value, expected()[section][key], `${section} ${key}`);
}
const url = (name, query = "") => `${shop.base}/${name}${query}`;
const body = async (r) => Buffer.from(await r.arrayBuffer());
const conditional = (u, etag) => new Promise((resolve, reject) => {
  http.get(u, { headers: { "If-None-Match": etag } }, (res) => { res.resume(); resolve(res.statusCode); }).on("error", reject);
});

const TARGETS = {
  "std.nsp": ["16.0.0", "16.0.1", "15", "20"],
  "low.nsp": ["16.0.0"],
  "cnmt-only.nsp": ["16.0.0"],
  "titlekey.nsz": ["16.0.0"],
  "plain.nsz": ["18.1.0"],
  "cart.xcz": ["17.0.0"],
};

test("every game lowered to a target has the same length, and bytes that do not change between releases", async () => {
  for (const [name, targets] of Object.entries(TARGETS)) {
    for (const target of targets) {
      const r = await fetch(url(name, `?rewrap=${target}`));
      assert.equal(r.status, 200, `${name} ${target}`);
      const bytes = await body(r);
      assert.equal(bytes.length, files[name].length, "same size as the original");
      const head = await fetch(url(name, `?rewrap=${target}`), { method: "HEAD" });
      assert.equal(head.headers.get("content-length"), String(files[name].length));
      pin("bytes", `${name}?rewrap=${target}`, { length: bytes.length, sha256: sha(bytes), changed: !bytes.equals(files[name]) });
    }
  }
  assert.equal(golden.bytes["low.nsp?rewrap=16.0.0"].changed, false, "a file already within the target goes out as it is");
  const plain = await fetch(url("std.nsp"));
  assert.ok((await body(plain)).equals(files["std.nsp"]), "no ?rewrap= is the original");
});

test("ranges across patched bytes, resumes and refusals of ranges", async () => {
  const q = "?rewrap=16.0.0";
  const size = files["std.nsp"].length;
  const first = parsePfs0Header(files["std.nsp"]).entries[0];
  const cases = {
    "across-the-first-header": `bytes=${first.offset - 5}-${first.offset + 0x210}`,
    "suffix": "bytes=-100",
    "open-ended": `bytes=${first.offset + 0x100}-`,
    "past-the-end": `bytes=${size}-`,
  };
  for (const [label, range] of Object.entries(cases)) {
    const r = await fetch(url("std.nsp", q), { headers: { Range: range } });
    pin("ranges", label, { status: r.status, contentRange: r.headers.get("content-range"), sha256: sha(await body(r)) });
  }
  const etag = (await fetch(url("std.nsp", q), { method: "HEAD" })).headers.get("etag");
  const resumed = await fetch(url("std.nsp", q), { headers: { Range: "bytes=10-", "If-Range": etag } });
  const stale = await fetch(url("std.nsp", q), { headers: { Range: "bytes=10-", "If-Range": 'W/"stale"' } });
  pin("ranges", "if-range-match", { status: resumed.status, sha256: sha(await body(resumed)) });
  pin("ranges", "if-range-stale", { status: stale.status, length: (await body(stale)).length });
});

test("the ETag differs from the original and between targets, is the same for the same request, and validates only its own", async () => {
  const etagOf = async (query) => (await fetch(url("std.nsp", query), { method: "HEAD" })).headers.get("etag");
  const tags = [await etagOf(""), await etagOf("?rewrap=16.0.0"), await etagOf("?rewrap=16.0.1"), await etagOf("?rewrap=15")];
  assert.equal(new Set(tags).size, 4);
  assert.equal(await etagOf("?rewrap=16.0.0"), tags[1], "stable per request");
  assert.equal(await conditional(url("std.nsp"), tags[1]), 200, "a lowered tag does not validate the original");
  assert.equal(await conditional(url("std.nsp", "?rewrap=16.0.0"), tags[1]), 304);
  assert.equal(await conditional(url("std.nsp", "?rewrap=16.0.1"), tags[1]), 200, "nor another target");
  golden.etags.distinct = true;
});

const keysOnly = (n) => keysUpTo(K, n).keys;
const REFUSALS = {
  badTarget: { file: "std.nsp", query: "16.0", keys: () => K.keys },
  noKeys: { file: "std.nsp", query: "16.0.0", keys: () => new Map() },
  keysTooOld: { file: "std.nsp", query: "12.1.0", keys: () => keysOnly(16) },
  keyMissing: { file: "std.nsp", query: "16.0.0", keys: () => new Map([...K.keys].filter(([n]) => n !== "key_area_key_application_0f")) },
  unsupported: { file: "lone.nsp", query: "16.0.0", keys: () => K.keys },
  notAContainer: { file: "junk.nsp", query: "16.0.0", keys: () => K.keys },
  personalTicket: { file: "personal.nsp", query: "16.0.0", keys: () => K.keys },
};

test("every refusal keeps its status, its headers and the fields an old client reads", async () => {
  try {
    for (const [name, c] of Object.entries(REFUSALS)) {
      writeKeys(c.keys());
      harness.resetPlans();
      const got = {};
      for (const lang of ["en", "ko"]) {
        const r = await fetch(url(c.file, `?rewrap=${c.query}`), { headers: { "Accept-Language": lang } });
        const j = await r.json();
        assert.equal(typeof j.error, "string");
        assert.deepEqual(Object.keys(j.errors).sort(), [...LANGS].sort(), "every language is in errors");
        assert.equal(j.errors[lang], j.error, "error is errors in the asked language");
        got[lang] = { status: r.status, cacheControl: r.headers.get("cache-control"), error: j.error, code: j.code };
      }
      const head = await fetch(url(c.file, `?rewrap=${c.query}`), { method: "HEAD" });
      got.headStatus = head.status;
      pin("refusals", name, got);
    }
  } finally {
    writeKeys(K.keys);
    harness.resetPlans();
  }
  const codes = new Set(Object.values(golden.refusals).map((r) => r.en.code));
  for (const code of ["badTarget", "noKeys", "keysTooOld", "keyMissing", "unsupported", "personalTicket"]) assert.ok(codes.has(`rewrap.${code}`), code);
});

test("a refusal reads in all twelve client languages", async () => {
  writeKeys(keysOnly(16));
  harness.resetPlans();
  try {
    const text = {};
    for (const lang of LANGS) {
      const j = await (await fetch(url("std.nsp", "?rewrap=12.1.0"), { headers: { "Accept-Language": lang } })).json();
      text[lang] = { error: j.error, code: j.code };
    }
    pin("languages", "keysTooOld", text);
    assert.equal(new Set(Object.values(text).map((t) => t.error)).size, LANGS.length, "twelve different texts");
  } finally {
    writeKeys(K.keys);
    harness.resetPlans();
  }
});

function shopInfo(keysPath) {
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", `
    import route from "../../src/routes/shop-info.js";
    const res = { headers: {} };
    res.header = (k, v) => { res.headers[k] = v; return res; };
    res.json = (b) => { res.body = b; return res; };
    await route({}, res);
    process.stdout.write(JSON.stringify(res.body));
  `], {
    cwd: import.meta.dirname,
    env: { ...process.env, COOK_DATA_DIR: fs.mkdtempSync(path.join(root, "info-")), COOK_PROD_KEYS_PATH: keysPath },
    encoding: "utf8",
  });
  return JSON.parse(out);
}

test("shop info advertises nca-rewrap and how far the keys reach only while the server has usable keys", () => {
  const mine = shopInfo(keysFile);
  pin("shopInfo", "with-keys", { advertised: mine.features.includes("nca-rewrap"), rewrapMaxGen: mine.rewrapMaxGen, rewrapMaxFirmware: mine.rewrapMaxFirmware });
  const none = shopInfo(path.join(root, "no-keys-here", "prod.keys"));
  pin("shopInfo", "no-keys", { advertised: none.features.includes("nca-rewrap"), rewrapMaxGen: none.rewrapMaxGen ?? null, rewrapMaxFirmware: none.rewrapMaxFirmware ?? null });
  assert.ok(!JSON.stringify(mine).includes(K.headerKey.toString("hex")), "no key value");
});
