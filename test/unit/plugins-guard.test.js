import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createProcessGuards, currentPluginId, runInPlugin } from "../../src/plugins/guard.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

test("the plugin id follows everything a hook starts, awaited or not", async () => {
  const seen = [];
  await runInPlugin("p1", async () => {
    seen.push(currentPluginId());
    await new Promise((r) => setTimeout(r, 1));
    seen.push(currentPluginId());
    setImmediate(() => seen.push(currentPluginId()));
    await new Promise((r) => setTimeout(r, 5));
  }, { timeoutMs: 1000 });
  assert.deepEqual(seen, ["p1", "p1", "p1"]);
  assert.equal(currentPluginId(), null, "and not outside");
});

test("runInPlugin never rejects: a throw, a sync throw and a timeout come back as results", async () => {
  assert.equal((await runInPlugin("p", async () => { throw new Error("x"); }, { timeoutMs: 100 })).ok, false);
  assert.equal((await runInPlugin("p", () => { throw new Error("x"); }, { timeoutMs: 100 })).ok, false);
  const slow = await runInPlugin("p", (signal) => new Promise((r) => signal.addEventListener("abort", () => r("aborted"))), { timeoutMs: 20 });
  assert.equal(slow.timedOut, true);
});

test("the handlers read the plugin id: a rejection is handed to the registry, an exception writes the crash mark and exits", async () => {
  const rejected = [];
  const crashed = [];
  const logs = [];
  const exits = [];
  const g = createProcessGuards({ onPluginRejection: (id, e) => rejected.push([id, e.message]), writeCrash: (id) => crashed.push(id), log: (m) => logs.push(m), exit: (c) => exits.push(c) });
  await runInPlugin("p9", async () => { g.handleRejection(new Error("a")); }, { timeoutMs: 100 });
  assert.deepEqual(rejected, [["p9", "a"]]);
  assert.deepEqual(exits, []);
  await runInPlugin("p9", async () => { g.handleException(new Error("b")); }, { timeoutMs: 100 });
  assert.deepEqual(crashed, ["p9"]);
  assert.deepEqual(exits, [1]);
  g.handleRejection(new Error("core bug"));
  g.handleException(new Error("core crash"));
  assert.deepEqual(crashed, ["p9"], "no mark for code that is not a plugin's");
  assert.deepEqual(rejected, [["p9", "a"]], "a core rejection is not swallowed");
  assert.deepEqual(exits, [1, 1, 1]);
});

/** Runs a script in a child process; the parent never shares the handlers with the test runner. */
function runChild(source) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cf-guard-"));
  const file = path.join(dir, "child.mjs");
  fs.writeFileSync(file, source.replaceAll("__ROOT__", root));
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [file], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => { out += d; });
    p.stderr.on("data", (d) => { err += d; });
    p.on("close", (code) => resolve({ code, out, err }));
  });
}

const PRELUDE = `
import { createProcessGuards, runInPlugin } from "__ROOT__/src/plugins/guard.js";
const events = [];
const g = createProcessGuards({ onPluginRejection: (id, e) => events.push("rejected:" + id + ":" + e.message), writeCrash: (id) => events.push("crash:" + id) });
g.install();
`;

test("a promise a plugin leaves rejecting is caught by the real process handler and the process lives on", async () => {
  const r = await runChild(`${PRELUDE}
    await runInPlugin("floaty", async () => { Promise.reject(new Error("floating")); setImmediate(() => Promise.reject(new Error("later"))); }, { timeoutMs: 1000 });
    setTimeout(() => { console.log(JSON.stringify(events)); }, 50);`);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(JSON.parse(r.out), ["rejected:floaty:floating", "rejected:floaty:later"]);
});

test("a throw a plugin leaves in a timer writes the crash mark and the process exits, as before", async () => {
  const r = await runChild(`${PRELUDE}
    process.on("exit", () => console.log(JSON.stringify(events)));
    await runInPlugin("thrower", async () => { setTimeout(() => { throw new Error("late"); }, 5); }, { timeoutMs: 1000 });
    setTimeout(() => console.log("still alive"), 500);`);
  assert.equal(r.code, 1);
  assert.ok(!r.out.includes("still alive"));
  assert.deepEqual(JSON.parse(r.out.trim().split("\n").pop()), ["crash:thrower"]);
  assert.match(r.err, /late/);
});

test("a rejection from the core itself still ends the process, with the stack on stderr", async () => {
  const r = await runChild(`${PRELUDE}
    Promise.reject(new Error("core bug"));
    setTimeout(() => console.log("still alive"), 500);`);
  assert.equal(r.code, 1);
  assert.ok(!r.out.includes("still alive"));
  assert.match(r.err, /core bug/);
});
