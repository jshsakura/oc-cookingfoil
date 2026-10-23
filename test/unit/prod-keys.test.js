import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { p256 } from "@noble/curves/nist.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { gcm } from "@noble/ciphers/aes.js";

// The server's own prod.keys: parsed, written for the readers, and sealed on the way from a console.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "prod-keys-"));
process.env.COOK_DATA_DIR = root;
process.env.COOK_KEYS_DIR = path.join(root, "mounted");
delete process.env.COOK_PROD_KEYS_PATH;

const keys = await import("../../src/security/prod-keys.js");
const seal = await import("../../src/security/keys-seal.js");
const nsp = await import("../../src/meta/extract-providers/nsp.js");
const edits = await import("../../src/meta/admin-edits.js");

after(() => fs.rmSync(root, { recursive: true, force: true }));
beforeEach(async () => { await keys.remove({ actor: "test", via: "dashboard" }); seal.reset(); });

const HEADER = "a".repeat(64);
const FAKE = [
  "; dumped by a test",
  `header_key = ${HEADER}`,
  `key_area_key_application_00 = ${"b".repeat(32)}`,
  `master_key_00 = ${"C".repeat(32)}`,
  `titlekek_00 = ${"d".repeat(32)}`,
  `titlekek_01 = ${"e".repeat(32)}`,
  "",
].join("\r\n");

const reasonOf = (fn) => {
  try {
    fn();
  } catch (err) {
    assert.ok(!/aaaa|bbbb|cccc|dddd|1234/i.test(err.message), `no key value in "${err.message}"`);
    return err.reason;
  }
  return null;
};

test("the parser takes a prod.keys dump and refuses anything else without echoing a value", () => {
  const parsed = keys.parseKeys(FAKE);
  assert.equal(parsed.size, 5);
  assert.equal(parsed.get("master_key_00"), "c".repeat(32), "hex is lower-cased");
  assert.equal(reasonOf(() => keys.parseKeys(`${FAKE}\nthis is not a key line 1234`)), "format");
  assert.equal(reasonOf(() => keys.parseKeys(`${FAKE}\nHEADER_KEY = 1234`)), "format", "names are lower case");
  assert.equal(reasonOf(() => keys.parseKeys(`<html>${"x".repeat(10)}</html>`)), "format");
  assert.equal(reasonOf(() => keys.parseKeys(FAKE.replace(/header_key.*\r\n/, ""))), "no-header-key");
  assert.equal(reasonOf(() => keys.parseKeys(FAKE.replace(HEADER, "a".repeat(60)))), "no-header-key", "header_key is 32 bytes");
  assert.equal(reasonOf(() => keys.parseKeys(`header_key = ${HEADER}\ntitlekek_00 = ${"d".repeat(32)}\n`)), "format", "no key area or master key");
  assert.equal(reasonOf(() => keys.parseKeys(FAKE + `# ${"1234".repeat(16 * 1024)}`)), "too-large");
  assert.equal(reasonOf(() => keys.parseKeys(42)), "format");
});

test("an upload is written 0600 where every reader looks, shows at once, and only it can be removed", async () => {
  assert.deepEqual(keys.status(), { present: false, source: null, uploadedAt: null, keyCount: 0, hasHeaderKey: false, titleKekCount: 0, maxGeneration: null, maxFirmware: null });
  const st = keys.install(FAKE, { actor: "alice", via: "dashboard" });
  assert.equal(st.present, true);
  assert.equal(st.source, "upload");
  assert.equal(st.keyCount, 5);
  assert.equal(st.hasHeaderKey, true);
  assert.equal(st.titleKekCount, 2);
  assert.equal(st.maxGeneration, 0, "the highest generation with both a key area key and a title kek");
  assert.equal(st.maxFirmware, "1.0.0");
  assert.match(st.uploadedAt, /^\d{4}-\d\d-\d\dT/);
  assert.ok(!JSON.stringify(st).includes(HEADER));

  const file = path.join(root, "keys", "prod.keys");
  assert.equal(keys.keysFile(), file);
  assert.equal(keys.keysDir(), path.dirname(file));
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.ok(!fs.readFileSync(file, "utf8").includes("\r"), "line endings are normalised");
  assert.deepEqual(fs.readdirSync(path.dirname(file)).filter((f) => f.includes("tmp")), [], "no temporary file left");

  assert.equal(edits.recent(1)[0].kind, "server");
  assert.equal(edits.recent(1)[0].id, "prod.keys");
  assert.ok(!JSON.stringify(edits.recent(5)).includes(HEADER));

  assert.equal(await keys.remove({ actor: "alice", via: "dashboard" }), true);
  assert.equal(keys.status().present, false);
  const trashed = fs.readdirSync(root, { recursive: true }).filter((f) => f.includes(".cookingfoil-trash") && f.endsWith(path.join("keys", "prod.keys")));
  assert.equal(trashed.length, 1, "the upload goes to the data folder's trash under its own path");
  assert.equal(fs.statSync(path.join(root, trashed[0])).mode & 0o777, 0o600, "and stays readable by the owner only");
  assert.equal(keys.keysFile(), path.join(root, "mounted", "prod.keys"), "back to the configured file");
  assert.equal(await keys.remove({ actor: "alice", via: "dashboard" }), false, "nothing uploaded to remove");
});

test("a mounted file counts as present and is never removed", async () => {
  fs.mkdirSync(path.join(root, "mounted"), { recursive: true });
  fs.writeFileSync(path.join(root, "mounted", "prod.keys"), FAKE);
  try {
    assert.deepEqual({ ...keys.status(), uploadedAt: null }, { present: true, source: "file", uploadedAt: null, keyCount: 5, hasHeaderKey: true, titleKekCount: 2, maxGeneration: 0, maxFirmware: "1.0.0" });
    assert.equal(await keys.remove({ actor: "alice", via: "dashboard" }), false);
    assert.ok(fs.existsSync(path.join(root, "mounted", "prod.keys")));
    keys.install(FAKE, { actor: "alice", via: "dashboard" });
    assert.equal(keys.status().source, "upload", "an upload wins over the mounted file");
  } finally {
    fs.rmSync(path.join(root, "mounted"), { recursive: true, force: true });
  }
});

test("the NSP extractor sees new keys without a restart", async () => {
  assert.equal(await nsp.keysAvailable(), false);
  keys.install(FAKE, { actor: "alice", via: "dashboard" });
  assert.equal(await nsp.keysAvailable(), true);
  assert.equal((await nsp.status()).keysPresent, true);
});

/** The console's half, with the same primitives the RetroAchievements page uses. */
function sealText(publicKey, nonce, text) {
  const eph = p256.utils.randomSecretKey();
  const x = p256.getSharedSecret(eph, Buffer.from(publicKey, "base64url")).slice(1, 33);
  const key = hkdf(sha256, x, undefined, new TextEncoder().encode(seal.INFO), 32);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = gcm(key, iv, new TextEncoder().encode(nonce)).encrypt(new TextEncoder().encode(text));
  const b64 = (u8) => Buffer.from(u8).toString("base64url");
  return { nonce, epk: b64(p256.getPublicKey(eph, false)), iv: b64(iv), ct: b64(ct) };
}

test("a sealed envelope opens once, for the console that asked, within five minutes", () => {
  const now = 1_000_000;
  const box = seal.open("console-a", now);
  assert.equal(Buffer.from(box.publicKey, "base64url").length, 65);
  assert.equal(box.expiresAt, now + 5 * 60 * 1000);
  const env = sealText(box.publicKey, box.nonce, FAKE);
  assert.deepEqual(seal.unseal("console-b", env, now), { error: "gone" }, "another console's nonce");
  assert.deepEqual(seal.unseal("console-a", env, now), { text: FAKE });
  assert.deepEqual(seal.unseal("console-a", env, now), { error: "gone" }, "single use");

  const late = seal.open("console-a", now);
  assert.deepEqual(seal.unseal("console-a", sealText(late.publicKey, late.nonce, FAKE), late.expiresAt + 1), { error: "gone" }, "expired");

  const other = seal.open("console-a", now);
  const wrongAad = sealText(other.publicKey, "another-nonce", FAKE);
  assert.deepEqual(seal.unseal("console-a", { ...wrongAad, nonce: other.nonce }, now), { error: "sealed" }, "the nonce is bound in");
  const bad = seal.open("console-a", now);
  assert.deepEqual(seal.unseal("console-a", { nonce: bad.nonce, epk: "x", iv: "y", ct: "z" }, now), { error: "sealed" });
  const big = seal.open("console-a", now);
  assert.deepEqual(seal.unseal("console-a", sealText(big.publicKey, big.nonce, "#".repeat(70 * 1024)), now), { error: "too-large" });
  assert.deepEqual(seal.unseal("console-a", {}, now), { error: "sealed" });
});
