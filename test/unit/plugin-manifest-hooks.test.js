// The manifest side of the request, route and event hooks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseManifest } from "../../src/plugins/manifest.js";
import { makeDataDir, manifestOf, newRegistry, writePlugin } from "../support/plugin-fixtures.js";

const base = (extra) => manifestOf("demo", extra);
const route = (extra = {}) => ({ name: "echo", method: "POST", access: "device", ...extra });
const problems = (m) => { const r = parseManifest(m); return r.ok ? [] : r.problems; };

test("routes: names, methods, access and limits are checked, and defaults are filled in", () => {
  const ok = parseManifest(base({ provides: ["route"], routes: [route()] }));
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.manifest.routes, [{ name: "echo", method: "POST", access: "device", maxBody: 256 * 1024, timeoutMs: 10_000 }]);
  for (const bad of [route({ name: "Echo" }), route({ name: "a/b" }), route({ method: "PUT" }), route({ access: "anyone" }), route({ maxBody: 5 * 1024 * 1024 }), route({ timeoutMs: 60_000 }), route({ maxBody: 0 })]) {
    assert.deepEqual(problems(base({ provides: ["route"], routes: [bad] })), ["bad-routes"], JSON.stringify(bad));
  }
  assert.deepEqual(problems(base({ provides: ["route"], routes: [route(), route()] })), ["bad-routes"], "two routes of one name");
  assert.deepEqual(problems(base({ provides: ["route"] })), ["routes-mismatch"], "a route plugin that lists none");
  assert.deepEqual(problems(base({ provides: ["metadata"], routes: [route()] })), ["routes-mismatch"], "routes without saying route");
});

test("events: identity is a short list of what the core knows, and only with event", () => {
  assert.deepEqual(parseManifest(base({ provides: ["event"], events: { identity: ["ip"] } })).manifest.events, { identity: ["ip"] });
  assert.deepEqual(parseManifest(base({ provides: ["event"] })).manifest.events, { identity: [] });
  assert.deepEqual(problems(base({ provides: ["event"], events: { identity: ["email"] } })), ["bad-events"]);
  assert.deepEqual(problems(base({ provides: ["event"], events: { identity: ["ip", "ip"] } })), ["bad-events"]);
  assert.deepEqual(problems(base({ provides: ["metadata"], events: { identity: ["ip"] } })), ["identity-without-event"]);
});

test("console facts may be asked for by a request or route plugin, not by one that only listens", () => {
  assert.equal(parseManifest(base({ provides: ["request"], console: ["firmware"] })).ok, true);
  assert.equal(parseManifest(base({ provides: ["route"], routes: [route()], console: ["region"] })).ok, true);
  assert.deepEqual(problems(base({ provides: ["event"], console: ["firmware"] })), ["console-without-variant"]);
});

test("a plugin that says request, route or event must export what it promised, or it does not start", async () => {
  const d = makeDataDir();
  const env = newRegistry(d, { limits: { startFailLimit: 1 } });
  writePlugin(d, "no-before", { manifest: manifestOf("no-before", { provides: ["request"] }), body: "export default {};" });
  writePlugin(d, "no-route", { manifest: manifestOf("no-route", { provides: ["route"], routes: [route()] }), body: "export default { routes: {} };" });
  writePlugin(d, "no-event", { manifest: manifestOf("no-event", { provides: ["event"] }), body: "export default { start() {} };" });
  await env.registry.init();
  for (const [id, why] of [["no-before", "missing-hook-beforeDownload"], ["no-route", "missing-route-echo"], ["no-event", "missing-event-handler"]]) {
    await env.registry.setEnabled(id, true);
    assert.match(env.registry.view(id).lastError ?? "", new RegExp(why), id);
    assert.notEqual(env.registry.view(id).state, "on", id);
  }
});
