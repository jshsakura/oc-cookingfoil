import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runNsz } from "../../src/meta/nsz-runner.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nsz-markers-"));
const stub = path.join(dir, "nsz.mjs");
fs.writeFileSync(stub, `#!/usr/bin/env node
const steps = [["out", "[VERIFY NSZ] x\\n[TICK"], ["err", "progress 50%\\n"], ["out", "ETLESS] 0123.nca\\n"]];
const next = (i) => { if (i === steps.length) return; const [s, t] = steps[i]; (s === "out" ? process.stdout : process.stderr).write(t, () => setTimeout(() => next(i + 1), 80)); };
next(0);
`, { mode: 0o755 });

test("a ticketless marker split across stdout chunks with stderr in between is still seen", async () => {
  const { done } = runNsz({ bin: stub, args: [], lowPriority: false });
  const result = await done;
  assert.equal(result.code, 0);
  assert.equal(result.unverified, true);
});
