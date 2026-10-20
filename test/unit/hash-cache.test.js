import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { HashCache } from "../../src/helpers/hash-cache.js";

const memStore = () => { const m = new Map(); return { get: (k) => m.get(k), set: (k, v) => m.set(k, v), prune: () => {} }; };
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const entry = (abs) => { const st = fs.statSync(abs); return { abs, size: st.size, mtimeMs: st.mtimeMs, ctimeMs: st.ctimeMs, ino: st.ino }; };

test("an in-place overwrite with the same size and mtime put back is hashed again", async () => {
  const abs = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hc-")), "core.nro");
  fs.writeFileSync(abs, "aaaa");
  fs.utimesSync(abs, 1_700_000_000, 1_700_000_000);
  const cache = new HashCache(memStore());
  assert.equal(await cache.hash(entry(abs)), sha("aaaa"));

  await new Promise((r) => setTimeout(r, 20)); // ctime moves on the write below
  fs.writeFileSync(abs, "bbbb");
  fs.utimesSync(abs, 1_700_000_000, 1_700_000_000);
  assert.equal(await cache.hash(entry(abs)), sha("bbbb"));
});
