import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.COOK_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "cf-hb-langs-"));
const { readNro } = await import("../../src/meta/homebrew.js");

/** An .nro whose NACP names the app and sets every supported-language bit, as the homebrew tools do. */
function nro() {
  const nacp = Buffer.alloc(0x4000);
  nacp.write("Sly Port", 0x0);
  nacp.write("Example Dev", 0x200);
  nacp.writeUInt32LE(0xfff, 0x302c);
  nacp.write("0.4.0", 0x3060);
  const head = Buffer.alloc(0x100);
  head.write("NRO0", 0x10);
  head.writeUInt32LE(0x100, 0x18);
  const aset = Buffer.alloc(0x38);
  aset.write("ASET", 0);
  aset.writeBigUInt64LE(0x38n, 0x18);
  aset.writeBigUInt64LE(BigInt(nacp.length), 0x20);
  return Buffer.concat([head, aset, nacp]);
}

test("a homebrew app lists no supported languages, even when its NACP sets every flag", async () => {
  const file = path.join(process.env.COOK_DATA_DIR, "app.nro");
  fs.writeFileSync(file, nro());
  const meta = await readNro(file);
  assert.equal(meta.name, "Sly Port");
  assert.equal(meta.version, "0.4.0");
  assert.equal("languages" in meta, false);
});
