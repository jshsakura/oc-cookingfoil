import { test } from "node:test";
import assert from "node:assert/strict";
import { displayVersionOf, recordFromFacts, englishNameOf } from "../../src/meta/content-meta.js";
import { decorateNameWithAlias } from "../../src/create-index-content.js";
import { readCnmtFacts, firmwareString } from "../../src/meta/cnmt-parse.js";

test("update display version is the NUL-padded text at 0x3060 in the NACP", () => {
  const nacp = Buffer.alloc(0x4000);
  nacp.write("1.4.1", 0x3060, "utf8");
  assert.equal(displayVersionOf(nacp), "1.4.1");
});

test("an empty display version is reported as missing", () => {
  assert.equal(displayVersionOf(Buffer.alloc(0x4000)), null);
});

// type: 0x80 application, 0x81 patch, 0x82 add-on. contents: [size, contentType].
function buildCnmt(type, required, contents) {
  const extended = Buffer.alloc(0x10);
  extended.writeUInt32LE(required, 0x08);
  const header = Buffer.alloc(0x20);
  header.writeBigUInt64LE(0x0100000000010000n, 0);
  header[0x0C] = type;
  header.writeUInt16LE(extended.length, 0x0E);
  header.writeUInt16LE(contents.length, 0x10);
  const records = contents.map(([size, contentType]) => {
    const record = Buffer.alloc(0x38);
    record.writeUIntLE(size, 0x30, 6);
    record[0x36] = contentType;
    return record;
  });
  return Buffer.concat([header, extended, ...records]);
}

const FW_16_0_3 = (16 << 26) | (0 << 20) | (3 << 16);

test("a game's install size counts every content except delta fragments", () => {
  const facts = readCnmtFacts(buildCnmt(0x80, FW_16_0_3, [[5_000_000_000, 1], [400_000, 3], [9_999, 6]]));
  assert.deepEqual(facts, { contentSize: 5_000_400_000, requiredSystemVersion: FW_16_0_3, requiredApplicationVersion: null });
});

test("a DLC reports the base update it needs, not a firmware", () => {
  const facts = readCnmtFacts(buildCnmt(0x82, 196608, [[1_000, 2]]));
  assert.equal(facts.requiredApplicationVersion, 196608);
  assert.equal(facts.requiredSystemVersion, null);
});

test("a truncated cnmt is rejected instead of guessed", () => {
  assert.equal(readCnmtFacts(buildCnmt(0x80, 0, [[1, 1]]).subarray(0, 0x40)), null);
  assert.equal(readCnmtFacts(Buffer.alloc(4)), null);
});

test("firmware numbers read as major.minor.micro and zero means none", () => {
  assert.equal(firmwareString(FW_16_0_3), "16.0.3");
  assert.equal(firmwareString(0), null);
  assert.equal(firmwareString(65536), null);
});

test("the stored record adds the meta NCA and keeps only known fields", () => {
  const facts = { contentSize: 1000, requiredSystemVersion: FW_16_0_3, requiredApplicationVersion: null };
  assert.deepEqual(recordFromFacts(facts, 24, { displayVersion: "1.0.2", englishName: "Absolum" }),
    { installSize: 1024, nacpRead: true, requiredFirmware: "16.0.3", displayVersion: "1.0.2", englishName: "Absolum" });
  assert.deepEqual(recordFromFacts(facts, 24, {}), { installSize: 1024, nacpRead: true, requiredFirmware: "16.0.3" },
    "a NACP that was read but empty is still marked read, so it is not read again");
  assert.deepEqual(recordFromFacts({ ...facts, requiredSystemVersion: null }, 0, null), { installSize: 1000 });
});

function nacpWith(slots) {
  const nacp = Buffer.alloc(0x4000);
  for (const [slot, name] of Object.entries(slots)) nacp.write(name, Number(slot) * 0x300, "utf8");
  return nacp;
}

test("the English title comes from the en-US slot, else en-GB", () => {
  assert.equal(englishNameOf(nacpWith({ 0: "Absolum", 12: "Absolum" })), "Absolum");
  assert.equal(englishNameOf(nacpWith({ 1: "Pokémon LeafGreen" })), "Pokémon LeafGreen");
});

test("a NACP without an English slot, or with Korean in it, gives no English title", () => {
  assert.equal(englishNameOf(nacpWith({ 12: "압솔룸" })), null);
  assert.equal(englishNameOf(nacpWith({ 0: "압솔룸" })), null);
});

test("a Korean name gets the English title from titledb first, then from the NACP", () => {
  assert.equal(decorateNameWithAlias("압솔룸", null, "Absolum"), "압솔룸 (Absolum)");
  assert.equal(decorateNameWithAlias("젤다의 전설", { aliases: ["The Legend of Zelda"] }, "Zelda NACP"), "젤다의 전설 (The Legend of Zelda)");
  assert.equal(decorateNameWithAlias("엘와의 유산 Alwa's Legacy", null, "Alwa's Legacy"), "엘와의 유산 Alwa's Legacy",
    "a name that already spells the English title is left alone");
  assert.equal(decorateNameWithAlias("A Hat in Time", null, "A Hat in Time"), "A Hat in Time");
});
