import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// "A feature without a registry entry is not finished." Every route the server answers has a
// capability in src/capabilities/, or an opt-out with a reason in src/capabilities/opt-out.js.
// Routes that predate the registry are LEGACY_UNREGISTERED, and that list only shrinks.
process.env.COOK_DATA_DIR = mkdtempSync(path.join(tmpdir(), "cook-capability-coverage-"));
const { discoverRoutes, coverageProblems, ratchetProblems } = await import("../support/capability-routes.js");
const { registry } = await import("../../src/capabilities/registry.js");
const { routesOf } = await import("../../src/capabilities/define.js");
const { OPT_OUT, OPT_OUT_REASONS, LEGACY_UNREGISTERED } = await import("../../src/capabilities/opt-out.js");

// Ratchet ceilings. LEGACY_CEILING only goes down and is never raised. Raising OPT_OUT_CEILING is a reviewed decision:
// do it in the same change that adds the opt-out, and say why in the commit.
const LEGACY_CEILING = 268;
const OPT_OUT_CEILING = 95;
const HERE = "test/unit/capability-coverage.test.js";

const routes = discoverRoutes();
const current = { routes, capabilities: registry.all, optOut: OPT_OUT, legacy: LEGACY_UNREGISTERED, reasons: OPT_OUT_REASONS };
// The routes the lists claim, so the checks below test the checker, not today's drift.
const listed = { ...current, routes: [...registry.all.flatMap(routesOf), ...Object.keys(OPT_OUT), ...LEGACY_UNREGISTERED] };

test("the walk finds the admin API and the routes outside it", () => {
  for (const key of ["GET /admin/api/stats", "POST /admin/api/server-settings", "GET /api/admin/items/:kind/:id/fields", "GET /games.json", "GET /api/library/info"]) {
    assert.ok(routes.includes(key), `${key} not found; the walk lost a router`);
  }
  assert.ok(routes.some((r) => r.startsWith("POST /api/art/")), "upload-gated /api/art routes are walked");
  assert.ok(routes.some((r) => r.includes("/achievements/link")), "nested routers are walked");
  assert.ok(routes.some((r) => r.includes("/oauth/dropbox/callback")), "inline routes on the app are walked");
});

test("every route has a capability or an opt-out with a reason", () => {
  assert.deepEqual(coverageProblems(current), []);
});

test("a route added with neither a capability nor an opt-out fails and says where to fix it", () => {
  const problems = coverageProblems({ ...listed, routes: [...listed.routes, "POST /admin/api/fake-thing"] });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^Route POST \/admin\/api\/fake-thing has no capability\./);
  assert.match(problems[0], /src\/capabilities\/<area>\.js/);
  assert.match(problems[0], /OPT_OUT in src\/capabilities\/opt-out\.js with a reason/);
  // The opt-out path names the ceiling to raise with it, so following it never trips the ratchet.
  assert.match(problems[0], /raise OPT_OUT_CEILING in test\/unit\/capability-coverage\.test\.js by one in the same change/);
  assert.match(problems[0], /Never add it to LEGACY_UNREGISTERED or raise LEGACY_CEILING/);
});

test("an opt-out needs one of the fixed reasons, and legacy is not one you can pick", () => {
  const fake = "POST /admin/api/fake-thing";
  const withRoute = { ...listed, routes: [...listed.routes, fake] };
  assert.match(coverageProblems({ ...withRoute, optOut: { ...OPT_OUT, [fake]: "because" } }).join("\n"), /reason "because"/);
  assert.match(coverageProblems({ ...withRoute, optOut: { ...OPT_OUT, [fake]: "legacy-unregistered" } }).join("\n"), /reason "legacy-unregistered"/);
  assert.deepEqual(coverageProblems({ ...withRoute, optOut: { ...OPT_OUT, [fake]: "browser-only" } }), []);
});

test("an entry that names no route, or a route claimed twice, fails", () => {
  assert.match(coverageProblems({ ...listed, legacy: [...LEGACY_UNREGISTERED, "GET /admin/api/gone"] }).join("\n"), /no such route/);
  const twice = LEGACY_UNREGISTERED[0];
  assert.match(coverageProblems({ ...listed, optOut: { ...OPT_OUT, [twice]: "browser-only" } }).join("\n"), /listed twice/);
});

test("the legacy list only shrinks", () => {
  assert.deepEqual(ratchetProblems({ list: "LEGACY_UNREGISTERED", count: LEGACY_UNREGISTERED.length, ceiling: LEGACY_CEILING, where: HERE }), []);
});

test("opt-outs do not grow without raising their ceiling", () => {
  assert.deepEqual(ratchetProblems({ list: "OPT_OUT", count: Object.keys(OPT_OUT).length, ceiling: OPT_OUT_CEILING, where: HERE }), []);
});

test("a grown legacy list fails, and the message never suggests raising LEGACY_CEILING", () => {
  const [problem, ...rest] = ratchetProblems({ list: "LEGACY_UNREGISTERED", count: LEGACY_CEILING + 1, ceiling: LEGACY_CEILING, where: HERE });
  assert.equal(rest.length, 0);
  assert.ok(problem.startsWith(`LEGACY_UNREGISTERED has ${LEGACY_CEILING + 1} routes, more than LEGACY_CEILING (${LEGACY_CEILING}).`), problem);
  assert.match(problem, /never raised/);
  assert.match(problem, /register it as a capability or opt it out/);
  assert.doesNotMatch(problem, /raise LEGACY_CEILING|LEGACY_CEILING to/);
});

test("a grown opt-out list asks for OPT_OUT_CEILING to be raised in the same change", () => {
  const [problem] = ratchetProblems({ list: "OPT_OUT", count: 5, ceiling: 4, where: HERE });
  assert.equal(problem, "OPT_OUT grew from 4 to 5. If each new opt-out is right, raise OPT_OUT_CEILING in test/unit/capability-coverage.test.js to 5 in the same change and say why in the commit.");
  assert.doesNotMatch(problem, /only shrinks/);
});

test("a shrunk list asks for its own ceiling to follow it down", () => {
  assert.match(ratchetProblems({ list: "OPT_OUT", count: 3, ceiling: 4, where: HERE })[0], /^OPT_OUT shrank to 3\. Lower OPT_OUT_CEILING in test\/unit\/capability-coverage\.test\.js from 4 to 3/);
  assert.match(ratchetProblems({ list: "LEGACY_UNREGISTERED", count: 3, ceiling: 4, where: HERE })[0], /^LEGACY_UNREGISTERED shrank to 3\. Lower LEGACY_CEILING in test\/unit\/capability-coverage\.test\.js from 4 to 3/);
});
