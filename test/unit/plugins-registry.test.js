import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { BODIES, makeDataDir, manifestOf, newRegistry, writePlugin } from "../support/plugin-fixtures.js";

const stateOf = (r, id) => r.list().find((p) => p.id === id)?.state;
/** The healthy neighbour every failure test keeps next to the bad plugin. */
async function boot(bad, { badBody, badManifest, opts, enableBad = true } = {}) {
  const d = makeDataDir();
  writePlugin(d, "good");
  if (bad) writePlugin(d, bad, { body: badBody, manifest: badManifest ?? manifestOf(bad) });
  const env = newRegistry(d, opts);
  await env.registry.init();
  await env.registry.setEnabled("good", true);
  if (bad && enableBad) await env.registry.setEnabled(bad, true).catch(() => {});
  return { d, ...env };
}
const neighbourWorks = async (registry) => {
  assert.equal(stateOf(registry, "good"), "on");
  assert.deepEqual((await registry.callHook("good", "metadata", { id: "t1" })).value, { names: { en: "ok-t1" } });
};

test("a plugin found for the first time is off, and stays off across a restart", async () => {
  const d = makeDataDir();
  writePlugin(d, "fresh");
  const a = newRegistry(d);
  await a.registry.init();
  assert.equal(stateOf(a.registry, "fresh"), "off");
  assert.equal(a.registry._instance("fresh"), null);
  const b = newRegistry(d, { db: a.db });
  await b.registry.init();
  assert.equal(stateOf(b.registry, "fresh"), "off");
});

test("a broken manifest is listed as broken with why, and does not stop the others", async () => {
  const d = makeDataDir();
  writePlugin(d, "good");
  writePlugin(d, "bad", { rawManifest: "{" });
  const { registry } = newRegistry(d);
  await registry.init();
  await registry.setEnabled("good", true);
  const bad = registry.list().find((p) => p.id === "bad");
  assert.equal(bad.state, "broken");
  assert.deepEqual(bad.problems, ["bad-json"]);
  await assert.rejects(registry.setEnabled("bad", true), { code: "broken" });
  await neighbourWorks(registry);
});

test("another apiVersion is incompatible and names the version it needs", async () => {
  const d = makeDataDir();
  writePlugin(d, "future", { manifest: { ...manifestOf("future"), apiVersion: 3 } });
  const { registry } = newRegistry(d);
  await registry.init();
  const p = registry.list()[0];
  assert.equal(p.state, "incompatible");
  assert.equal(p.needs, 3);
  await assert.rejects(registry.setEnabled("future", true), { code: "incompatible" });
});

test("an import that throws fails only that plugin", async () => {
  const { registry } = await boot("bad", { badBody: BODIES.throwsOnImport });
  assert.equal(stateOf(registry, "bad"), "failed");
  assert.match(registry.list().find((p) => p.id === "bad").lastError, /boom at import/);
  assert.deepEqual(await registry.callHook("bad", "metadata", {}), { skipped: "not-running" });
  await neighbourWorks(registry);
});

test("a start() that throws fails only that plugin", async () => {
  const { registry } = await boot("bad", { badBody: BODIES.throwsOnStart });
  assert.equal(stateOf(registry, "bad"), "failed");
  await neighbourWorks(registry);
});

test("a start() that never ends is cut off at the limit", async () => {
  const { registry } = await boot("bad", { badBody: BODIES.hangsOnStart });
  assert.equal(stateOf(registry, "bad"), "failed");
  assert.equal(registry.list().find((p) => p.id === "bad").lastError, "start-timeout");
  await neighbourWorks(registry);
});

test("a plugin that lacks a hook its provides promises fails to start", async () => {
  const { registry } = await boot("bad", { badBody: BODIES.noMetadataHook });
  assert.match(registry.list().find((p) => p.id === "bad").lastError, /missing-hook-metadata/);
});

test("three start failures in a row, across restarts, switch it off with the reason and tell the operator once", async () => {
  const d = makeDataDir();
  writePlugin(d, "bad", { body: BODIES.throwsOnStart });
  const first = newRegistry(d);
  await first.registry.init();
  await first.registry.setEnabled("bad", true); // failure 1 (manual enable resets the count, then fails once)
  let last = first;
  for (let i = 0; i < 2; i++) {
    last = newRegistry(d, { db: first.db });
    await last.registry.init(); // failures 2 and 3
  }
  const p = last.registry.list()[0];
  assert.equal(p.state, "auto-disabled");
  assert.equal(p.enabled, false);
  assert.equal(p.disabledReason, "start-failed");
  assert.ok(p.disabledAt);
  assert.equal(last.notes.filter((n) => n.event === "auto-disabled").length, 1);
  const again = newRegistry(d, { db: first.db });
  await again.registry.init();
  assert.equal(again.registry._instance("bad"), null, "no fourth attempt");
});

test("a start success resets the failure count", async () => {
  const d = makeDataDir();
  writePlugin(d, "flaky", { body: BODIES.throwsOnStart });
  const a = newRegistry(d);
  await a.registry.init();
  await a.registry.setEnabled("flaky", true);
  assert.equal(a.registry.list()[0].failStreak, 1);
  writePlugin(d, "flaky", { body: BODIES.ok });
  const b = newRegistry(d, { db: a.db });
  await b.registry.init();
  assert.equal(b.registry.list()[0].state, "on");
  assert.equal(b.registry.list()[0].failStreak, 0);
});

test("a boot mark left by a crash keeps that plugin off at the next start", async () => {
  const d = makeDataDir();
  writePlugin(d, "killer");
  writePlugin(d, "good");
  const a = newRegistry(d);
  await a.registry.init();
  await a.registry.setEnabled("killer", true);
  await a.registry.setEnabled("good", true);
  await a.registry.stopAll();
  fs.writeFileSync(path.join(d, "plugins-booting"), "killer\n"); // the process died inside killer's start()
  const b = newRegistry(d, { db: a.db });
  await b.registry.init();
  assert.equal(stateOf(b.registry, "killer"), "crash-disabled");
  assert.equal(b.registry._instance("killer"), null);
  assert.equal(stateOf(b.registry, "good"), "on");
  assert.equal(fs.existsSync(path.join(d, "plugins-booting")), false, "the mark is cleared once read");
  assert.equal(b.notes.filter((n) => n.event === "crash-disabled").length, 1);
});

test("a crash file written by the process handler keeps that plugin off too", async () => {
  const d = makeDataDir();
  writePlugin(d, "thrower");
  const a = newRegistry(d);
  await a.registry.init();
  await a.registry.setEnabled("thrower", true);
  a.registry.writeCrash("thrower", new Error("late throw"));
  await a.registry.stopAll();
  const b = newRegistry(d, { db: a.db });
  await b.registry.init();
  assert.equal(stateOf(b.registry, "thrower"), "crash-disabled");
});

test("a hook that throws is that call's failure only; the next plugin's answer still comes", async () => {
  const { registry } = await boot("bad", { badBody: BODIES.throwsInHook });
  const r = await registry.callHook("bad", "metadata", {});
  assert.match(r.error.message, /boom in hook/);
  assert.equal(r.error.timedOut, false);
  assert.equal(stateOf(registry, "bad"), "on", "one failure does not stop it");
  await neighbourWorks(registry);
});

test("a hook that never ends is cut off at the limit and counted", async () => {
  const { registry } = await boot("bad", { badBody: BODIES.hangsInHook });
  const r = await registry.callHook("bad", "metadata", {});
  assert.equal(r.error.timedOut, true);
  assert.equal(registry.list().find((p) => p.id === "bad").hookStreak, 1);
  await neighbourWorks(registry);
});

test("five failures in a row cool the plugin for 10 minutes; each repeat doubles, up to 60; a success resets", async () => {
  const { registry, clock, d } = await boot("bad", { badBody: BODIES.throwsInHook });
  const fail = async (n) => { for (let i = 0; i < n; i++) await registry.callHook("bad", "metadata", {}); };
  const minutesLeft = () => Math.round((registry.list().find((p) => p.id === "bad").retryAt - clock.t) / 60_000);

  await fail(4);
  assert.equal(stateOf(registry, "bad"), "on");
  await fail(1);
  assert.equal(stateOf(registry, "bad"), "cooling");
  assert.equal(minutesLeft(), 10);
  assert.equal((await registry.callHook("bad", "metadata", {})).skipped, "cooling");

  for (const want of [20, 40, 60, 60]) {
    clock.t += 61 * 60_000;
    assert.equal(stateOf(registry, "bad"), "on", "the pause is over");
    await fail(1); // one failed retry is enough after a pause
    assert.equal(minutesLeft(), want);
  }
  assert.equal(registry.list().find((p) => p.id === "bad").enabled, true, "cooling never switches it off for good");

  clock.t += 61 * 60_000;
  writePlugin(d, "bad", { body: BODIES.ok }); // fixed on disk; same running instance is what is called, so reset via a good hook below
  registry._instance("bad").metadata = async () => ({ ok: true });
  assert.deepEqual((await registry.callHook("bad", "metadata", {})).value, { ok: true });
  const p = registry.list().find((x) => x.id === "bad");
  assert.equal(p.hookStreak, 0);
  assert.equal(p.state, "on");
  await fail(0);
  registry._instance("bad").metadata = async () => { throw new Error("again"); };
  await fail(4);
  assert.equal(stateOf(registry, "bad"), "on", "back to needing five failures");
});

test("four failures with a success between them never cool the plugin", async () => {
  const { registry } = await boot("bad", { badBody: BODIES.throwsInHook });
  const inst = registry._instance("bad");
  const boom = inst.metadata;
  for (let round = 0; round < 3; round++) {
    for (let i = 0; i < 4; i++) await registry.callHook("bad", "metadata", {});
    inst.metadata = async () => ({});
    await registry.callHook("bad", "metadata", {});
    inst.metadata = boom;
  }
  assert.equal(stateOf(registry, "bad"), "on");
});

test("a rejection nobody awaits, attributed to the plugin, switches only that plugin off", async () => {
  const { registry } = await boot("bad", { badBody: BODIES.ok });
  await registry.pluginRejected("bad", new Error("floating"));
  assert.equal(registry._instance("bad"), null);
  const p = registry.list().find((x) => x.id === "bad");
  assert.equal(p.enabled, false);
  assert.equal(p.disabledReason, "unhandled-rejection");
  await neighbourWorks(registry);
});

test("a folder that disappears while running is stopped and shown as missing; coming back resumes it", async () => {
  const { registry, d } = await boot("tmp");
  assert.equal(stateOf(registry, "tmp"), "on");
  const dir = path.join(d, "plugins", "tmp");
  const moved = `${dir}.away`;
  fs.renameSync(dir, moved);
  await registry.rescan();
  assert.equal(stateOf(registry, "tmp"), "missing");
  assert.equal(registry._instance("tmp"), null);
  assert.equal(registry.list().find((p) => p.id === "tmp").enabled, true, "its switch is kept");
  await neighbourWorks(registry);
  fs.renameSync(moved, dir);
  await registry.rescan();
  assert.equal(stateOf(registry, "tmp"), "on");
});

test("a hook that fails with ENOENT because the folder is gone turns into missing without a scan first", async () => {
  const { registry, d } = await boot("tmp", { badBody: BODIES.enoentInHook });
  fs.rmSync(path.join(d, "plugins", "tmp"), { recursive: true });
  await registry.callHook("tmp", "metadata", {});
  assert.equal(stateOf(registry, "tmp"), "missing");
});

test("a folder that appears later is listed, off, without a restart", async () => {
  const { registry, d } = await boot(null);
  writePlugin(d, "later");
  await registry.rescan();
  assert.equal(stateOf(registry, "later"), "off");
});

test("safe mode starts nothing, keeps every switch as it was, and says so", async () => {
  const d = makeDataDir();
  writePlugin(d, "good");
  const a = newRegistry(d);
  await a.registry.init();
  await a.registry.setEnabled("good", true);
  await a.registry.stopAll();
  const b = newRegistry(d, { db: a.db, safeMode: true });
  await b.registry.init();
  const p = b.registry.list()[0];
  assert.equal(p.state, "off");
  assert.equal(p.enabled, true, "the stored switch is untouched");
  assert.equal(p.safeMode, true);
  assert.equal(b.registry._instance("good"), null);
  await assert.rejects(b.registry.setEnabled("good", true), { code: "safe-mode" });
  const c = newRegistry(d, { db: a.db });
  await c.registry.init();
  assert.equal(stateOf(c.registry, "good"), "on", "leaving safe mode brings it back");
});

test("a plugin that needs keys is not switched on until the operator confirms", async () => {
  const d = makeDataDir();
  writePlugin(d, "keyed", { manifest: manifestOf("keyed", { needsKeys: true }) });
  const { registry } = newRegistry(d);
  await registry.init();
  await assert.rejects(registry.setEnabled("keyed", true), { code: "keys-confirm-required" });
  assert.equal(stateOf(registry, "keyed"), "off");
  assert.equal((await registry.setEnabled("keyed", true, { confirmKeys: true })).state, "on");
});

test("variant keys are remembered, so a plugin that is off, cooling, missing or gone still owns its key", async () => {
  const d = makeDataDir();
  writePlugin(d, "wrap", { manifest: manifestOf("wrap", { provides: ["metadata"] }) });
  const a = newRegistry(d);
  await a.registry.init();
  await a.registry.setEnabled("wrap", true);
  a.registry.recordVariantKeys("wrap", ["rewrap"]);
  assert.deepEqual(a.registry.variantKeyStatus("rewrap"), { id: "wrap", available: true });
  await a.registry.setEnabled("wrap", false);
  assert.deepEqual(a.registry.variantKeyStatus("rewrap"), { id: "wrap", available: false });
  fs.rmSync(path.join(d, "plugins", "wrap"), { recursive: true });
  const b = newRegistry(d, { db: a.db });
  await b.registry.init();
  assert.deepEqual(b.registry.variantKeyStatus("rewrap"), { id: "wrap", available: false }, "remembered across a restart and a missing folder");
  assert.equal(b.registry.variantKeyStatus("never-heard-of"), null);
});

test("a manifest's variantKeys are known before the plugin ever runs", async () => {
  const d = makeDataDir();
  writePlugin(d, "wrap", { manifest: manifestOf("wrap", { provides: ["variant"], variantKeys: ["rewrap"] }), body: "export default { variants() { return []; }, plan() {} };" });
  const { registry } = newRegistry(d);
  await registry.init();
  assert.deepEqual(registry.variantKeyStatus("rewrap"), { id: "wrap", available: false });
});

test("ctx.fetch refuses a host the manifest did not name and an http url, redirects included", async () => {
  const { limitedFetch } = await import("../../src/plugins/context.js");
  const calls = [];
  const base = async (url) => {
    calls.push(String(url));
    return String(url).includes("api.example.com/jump")
      ? { status: 302, headers: new Headers({ location: "https://evil.example.net/x" }) }
      : { status: 200, headers: new Headers() };
  };
  const f = limitedFetch(["api.example.com"], base);
  assert.equal((await f("https://api.example.com/ok")).status, 200);
  await assert.rejects(f("https://other.example.com/"), { code: "PLUGIN_HOST_NOT_ALLOWED" });
  await assert.rejects(f("http://api.example.com/"), { code: "PLUGIN_HOST_NOT_ALLOWED" });
  await assert.rejects(f("https://api.example.com/jump"), { code: "PLUGIN_HOST_NOT_ALLOWED" });
  assert.ok(!calls.some((u) => u.includes("evil")), "the redirect target is never requested");
});

test("a hook is handed only the console facts its manifest asked for, and the language", async () => {
  const d = makeDataDir();
  const body = "export default { variants(item, o) { return [{ id: 'seen', got: o }]; }, plan() {}, wants: null };";
  writePlugin(d, "wrap", { manifest: manifestOf("wrap", { provides: ["variant"], console: ["firmware"] }), body });
  writePlugin(d, "blind", { manifest: manifestOf("blind", { provides: ["variant"] }), body });
  const { registry } = newRegistry(d);
  await registry.init();
  for (const id of ["wrap", "blind"]) await registry.setEnabled(id, true);
  const facts = { firmware: "21.0.1", language: "ko", region: "KR", clientVersion: "2.3.4" };
  const asked = (await registry.callHook("wrap", "variants", { id: "t" }, { lang: "ko", console: facts })).value[0].got;
  assert.deepEqual({ lang: asked.lang, console: asked.console }, { lang: "ko", console: { firmware: "21.0.1" } });
  assert.ok(asked.signal instanceof AbortSignal);
  const none = (await registry.callHook("blind", "variants", { id: "t" }, { console: facts })).value[0].got;
  assert.deepEqual(none.console, {}, "nothing asked, nothing given");
  assert.equal(none.lang, "en");
});

test("start() sees which console facts the plugin wants, not their values", async () => {
  const d = makeDataDir();
  const body = "let w; export default { start(ctx) { w = ctx.console; }, variants() { return [{ id: 'x', w }]; }, plan() {} };";
  writePlugin(d, "wrap", { manifest: manifestOf("wrap", { provides: ["variant"], console: ["region"] }), body });
  const { registry } = newRegistry(d);
  await registry.init();
  await registry.setEnabled("wrap", true);
  assert.deepEqual((await registry.callHook("wrap", "variants", {})).value[0].w, { wants: ["region"] });
});
