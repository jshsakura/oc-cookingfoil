import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createVerifier, decide } from "../../src/meta/file-verify.js";
import { hashRange, hashRangeHere } from "../../src/meta/hash-range.js";
import { buildPfs0, buildXci, buildCnmt, fakeNca } from "../support/switch-files.js";

// The file check against fake containers and a stub nstool: header slices whose
// marker reads "MOD" fail their signature, and each meta NCA reads as the cnmt the test set.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "cook-verify-"));
after(() => fs.rmSync(root, { recursive: true, force: true }));

const PROGRAM = "a".repeat(32);
const CONTROL = "b".repeat(32);
const META = "c".repeat(32);
const DELTA = "d".repeat(32);

function setup({ cnmt = null, tools = true } = {}) {
  const calls = [];
  const hashed = [];
  const nstool = async (bin, args) => {
    calls.push(args);
    if (args[0] === "-y") {
      const header = fs.readFileSync(args[args.length - 1]);
      assert.equal(header.length, 0xC00, "only the NCA header is handed over");
      const failed = header.includes(Buffer.from("MOD"));
      return { code: 0, out: `${failed ? "NCA Header Main Signature: FAIL" : "NCA Header Main Signature: GOOD"}\n[WARNING] NCA Partition 0 not readable\n` };
    }
    return { code: 0, out: "" };
  };
  // `cnmt` may map a mark inside the meta NCA to its own cnmt (a multi-title XCI).
  const cnmts = async (abs, metas) => metas.map((e) => {
    if (Buffer.isBuffer(cnmt) || !cnmt) return cnmt;
    const data = fs.readFileSync(abs).subarray(e.offset, e.offset + e.size);
    return Object.entries(cnmt).find(([mark]) => data.includes(Buffer.from(mark)))?.[1];
  }).filter(Boolean);
  const verifier = createVerifier({
    tools: async () => (tools ? { bin: "nstool", keys: "/keys/prod.keys" } : null),
    nstool,
    cnmts,
    hash: async (file, start, size) => { hashed.push(start); return hashRangeHere(file, start, size); },
    tmpRoot: root,
  });
  return { verifier, calls, hashed };
}

const noId = ({ identity: _i, ...r }) => r;

let n = 0;
function write(ext, buf) {
  const file = path.join(root, `game-${++n}.${ext}`);
  fs.writeFileSync(file, buf);
  return file;
}

const program = fakeNca("GOOD", 0x800);
const control = fakeNca("GOOD", 0x200);
const meta = fakeNca("GOOD", 0x100);
const files = (p = program) => [
  { name: `${PROGRAM}.nca`, data: p },
  { name: `${CONTROL}.nca`, data: control },
  { name: `${META}.cnmt.nca`, data: meta },
];
const records = (p = program) => [{ ncaId: PROGRAM, data: p, type: 1 }, { ncaId: CONTROL, data: control, type: 3 }];

// ── decide ───────────────────────────────────────────────────────────────

test("decide: everything passing is ok, a failed signature is modified", () => {
  assert.deepEqual(decide({ signature: "pass", hash: "pass" }), { verdict: "ok", reason: "ok", checks: { signature: "pass", hash: "pass" } });
  assert.equal(decide({ signature: "fail", failedIds: ["x"] }).verdict, "modified");
});

test("decide: unreadable, missing content and an unexplained hash mismatch are damaged", () => {
  assert.equal(decide({ readable: false }).reason, "unreadable");
  assert.equal(decide({ signature: "pass", missing: ["x"] }).reason, "missing-content");
  assert.equal(decide({ signature: "pass", hash: "fail", mismatched: ["x"] }).reason, "hash-mismatch");
});

test("decide: a hash mismatch on an NCA whose signature failed is the modification itself", () => {
  const r = decide({ signature: "fail", failedIds: ["x"], hash: "fail", mismatched: ["x"] });
  assert.equal(r.verdict, "modified");
  assert.deepEqual(r.checks, { signature: "fail", hash: "fail" });
});

test("decide: with nothing checked the file stays unchecked", () => {
  assert.equal(decide({}).verdict, "unchecked");
});

// ── verify ───────────────────────────────────────────────────────────────

test("an untouched NSP passes its signatures and, with hash on, its content hashes", async () => {
  const { verifier, calls } = setup({ cnmt: buildCnmt(records()) });
  const file = write("nsp", buildPfs0(files()));

  const r = await verifier.verify(file, { hash: true });

  assert.deepEqual(noId(r), { verdict: "ok", reason: "ok", checks: { signature: "pass", hash: "pass" } });
  assert.equal(calls.filter((a) => a[0] === "-y").length, 3);
  assert.deepEqual(calls[0].slice(0, 5), ["-y", "-t", "nca", "-k", "/keys/prod.keys"]);
});

test("without hash the content hashes are skipped", async () => {
  const { verifier } = setup({ cnmt: buildCnmt(records()) });
  const r = await verifier.verify(write("nsp", buildPfs0(files())));
  assert.deepEqual(r.checks, { signature: "pass", hash: "skip" });
  assert.equal(r.verdict, "ok");
});

test("a repacked NSP whose program NCA fails its signature is modified, even when its hash differs", async () => {
  const modded = fakeNca("MOD", 0x800);
  // The cnmt still carries the original program's hash.
  const { verifier } = setup({ cnmt: buildCnmt(records(program)) });
  const r = await verifier.verify(write("nsp", buildPfs0(files(modded))), { hash: true });
  assert.equal(r.verdict, "modified");
  assert.equal(r.reason, "signature-fail");
});

test("an NCA whose signature passes but whose bytes differ from the cnmt hash is damaged", async () => {
  const corrupted = Buffer.from(program);
  corrupted[0xD00] ^= 0xff;
  const { verifier } = setup({ cnmt: buildCnmt(records(program)) });
  const r = await verifier.verify(write("nsp", buildPfs0(files(corrupted))), { hash: true });
  assert.equal(r.verdict, "damaged");
  assert.equal(r.reason, "hash-mismatch");
});

test("an NCA the cnmt lists but the container lacks is damaged; a missing delta fragment is not", async () => {
  const gone = setup({ cnmt: buildCnmt([...records(), { ncaId: "e".repeat(32), data: Buffer.alloc(4), type: 2 }]) });
  assert.equal((await gone.verifier.verify(write("nsp", buildPfs0(files())))).reason, "missing-content");

  const delta = setup({ cnmt: buildCnmt([...records(), { ncaId: DELTA, data: Buffer.alloc(4), type: 6 }]) });
  assert.equal((await delta.verifier.verify(write("nsp", buildPfs0(files())), { hash: true })).verdict, "ok");
});

test("a file that is not a container, or is cut short, is damaged without running nstool", async () => {
  const { verifier, calls } = setup();
  assert.equal((await verifier.verify(write("nsp", Buffer.alloc(0x100, 7)))).reason, "unreadable");
  const whole = buildPfs0(files());
  assert.equal((await verifier.verify(write("nsp", whole.subarray(0, whole.length - 0x100)))).reason, "unreadable");
  assert.equal(calls.length, 0);
});

test("an NSZ gets its signatures checked but never its hashes (NCZ is compressed)", async () => {
  const { verifier } = setup({ cnmt: buildCnmt(records()) });
  const ncz = [{ name: `${PROGRAM}.ncz`, data: fakeNca("GOOD", 0x100) }, { name: `${CONTROL}.nca`, data: control }, { name: `${META}.cnmt.nca`, data: meta }];
  const r = await verifier.verify(write("nsz", buildPfs0(ncz)), { hash: true });
  assert.deepEqual(r.checks, { signature: "pass", hash: "skip" });
  assert.equal(r.verdict, "ok");
});

test("an XCI is read through its secure partition, hashes included", async () => {
  const { verifier } = setup({ cnmt: buildCnmt(records()) });
  const ok = await verifier.verify(write("xci", buildXci(files())), { hash: true });
  assert.deepEqual(noId(ok), { verdict: "ok", reason: "ok", checks: { signature: "pass", hash: "pass" } });

  const modded = await verifier.verify(write("xci", buildXci(files(fakeNca("MOD", 0x800)))));
  assert.equal(modded.verdict, "modified");
});

test("with no cnmt to read the hashes are skipped and the signatures decide", async () => {
  const { verifier } = setup({ cnmt: null });
  const r = await verifier.verify(write("nsp", buildPfs0(files())), { hash: true });
  assert.deepEqual(r.checks, { signature: "pass", hash: "skip" });
});

test("without nstool or keys a readable file stays unchecked", async () => {
  const { verifier, calls } = setup({ tools: false });
  const r = await verifier.verify(write("nsp", buildPfs0(files())), { hash: true });
  assert.equal(r.verdict, "unchecked");
  assert.deepEqual(r.checks, { signature: "skip", hash: "skip" });
  assert.equal(calls.length, 0);
});

test("a multi-title XCI reads every cnmt and merges their records", async () => {
  const meta2 = fakeNca("META2", 0x100);
  const two = [...files(), { name: `${"f".repeat(32)}.cnmt.nca`, data: meta2 }];
  const cnmts = (extra) => ({ GOOD: buildCnmt([{ ncaId: PROGRAM, data: program, type: 1 }]), META2: buildCnmt([{ ncaId: CONTROL, data: control, type: 3 }, ...extra]) });
  const { verifier } = setup({ cnmt: cnmts([]) });
  assert.deepEqual(noId(await verifier.verify(write("xci", buildXci(two)), { hash: true })), { verdict: "ok", reason: "ok", checks: { signature: "pass", hash: "pass" } });

  // Only the second title's cnmt lists the missing NCA, so finding it proves both were read.
  const missing = setup({ cnmt: cnmts([{ ncaId: "e".repeat(32), data: Buffer.alloc(4), type: 2 }]) });
  assert.equal((await missing.verifier.verify(write("xci", buildXci(two)))).reason, "missing-content");
});

test("a hash run skips the NCAs already hashed and reports each new one", async () => {
  const { verifier, hashed } = setup({ cnmt: buildCnmt(records()) });
  const seen = [];
  const r = await verifier.verify(write("nsp", buildPfs0(files())), { hash: true, known: { [PROGRAM]: true }, onHashed: (id, ok) => seen.push([id, ok]) });
  assert.equal(r.checks.hash, "pass");
  assert.equal(hashed.length, 1);
  assert.deepEqual(seen, [[CONTROL, true]]);
});

test("without hash, results known for every NCA stand in for the hash pass; a known mismatch still counts", async () => {
  const { verifier, hashed } = setup({ cnmt: buildCnmt(records()) });
  const file = write("nsp", buildPfs0(files()));
  assert.equal((await verifier.verify(file, { known: { [PROGRAM]: true, [CONTROL]: true } })).checks.hash, "pass");
  assert.equal((await verifier.verify(file, { known: { [PROGRAM]: false, [CONTROL]: true } })).reason, "hash-mismatch");
  assert.equal((await verifier.verify(file, { known: { [PROGRAM]: true } })).checks.hash, "skip");
  assert.equal(hashed.length, 0);
});

test("hashRange kills a child that runs past its timeout", async () => {
  const file = write("bin", Buffer.alloc(1024));
  await assert.rejects(hashRange(file, 0, 1024, { lowPriority: false, timeoutMs: 1 }), /hash timeout/);
});

test("hashRange hashes one byte range in a child process, like hashing it here", async () => {
  const file = write("bin", Buffer.from("0123456789abcdef"));
  assert.equal(await hashRange(file, 4, 8, { lowPriority: false }), await hashRangeHere(file, 4, 8));
  const ctrl = new AbortController();
  ctrl.abort();
  await assert.rejects(hashRange(file, 0, 4, { signal: ctrl.signal }), { name: "AbortError" });
});

test("the check says what the file is, every title a cartridge carries included", async () => {
  const update = Buffer.from(buildCnmt(records()));
  update.writeBigUInt64LE(0x0100000000010800n, 0);
  update.writeUInt8(0x81, 0x0c);
  const meta2 = fakeNca("META2", 0x100);
  const { verifier } = setup({ cnmt: { GOOD: buildCnmt(records()), META2: update } });
  const r = await verifier.verify(write("xci", buildXci([...files(), { name: `${"f".repeat(32)}.cnmt.nca`, data: meta2 }])));
  assert.equal(r.identity.titleId, "0100000000010000");
  assert.equal(r.identity.kind, "base");
  assert.deepEqual(r.identity.titleIds, ["0100000000010000", "0100000000010800"]);
});
