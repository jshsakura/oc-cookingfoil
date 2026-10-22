import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// The capability registry is the one place a feature is described for agents (MCP tools, API docs,
// the admin page's token notes). These rules keep every entry usable by a later MCP layer.
process.env.COOK_DATA_DIR = mkdtempSync(path.join(tmpdir(), "cook-capability-define-"));
const { defineCapability, capabilityProblems, tokenReach } = await import("../../src/capabilities/define.js");
const { buildRegistry, registry } = await import("../../src/capabilities/registry.js");
const { TOKEN_LOCKED } = await import("../../src/routes/admin/server-settings-api.js");

const base = () => ({
  id: "game_get",
  area: "games",
  title: "Get one game",
  description: "Get one game with its names, files, patches and art. Use game_find first to get titleId.",
  input: {
    type: "object",
    properties: { titleId: { type: "string", description: "16 hex digit title id, as game_find returns it" } },
    required: ["titleId"],
  },
  safety: "read",
  http: { method: "GET", path: "/admin/api/library/browse" },
  handler: async () => ({}),
});
const problemsOf = (patch) => capabilityProblems({ ...base(), ...patch });
const hasProblem = (patch, re) => assert.ok(problemsOf(patch).some((p) => re.test(p)), `expected ${re} in ${JSON.stringify(problemsOf(patch))}`);

test("a well-formed read capability has no problems and derives its access and token reach", () => {
  assert.deepEqual(capabilityProblems(base()), []);
  const cap = defineCapability(base());
  assert.equal(cap.access, "read");
  assert.equal(cap.token, true);
  assert.ok(Object.isFrozen(cap));
});

test("ids are snake_case and short", () => {
  hasProblem({ id: "GameGet" }, /id/);
  hasProblem({ id: "game-get" }, /id/);
  hasProblem({ id: "cf_" + "x".repeat(60) }, /id/);
  assert.deepEqual(problemsOf({ id: "help" }), []);
});

test("area must be a known area", () => {
  hasProblem({ area: "everything" }, /area/);
});

test("title and description are English only and sized for tool lists", () => {
  hasProblem({ title: "게임 하나" }, /title.*English/);
  hasProblem({ description: "게임 하나를 가져옵니다. 이름, 파일, 패치, 그림을 함께 돌려줍니다. titleId 가 필요합니다." }, /description.*English/);
  hasProblem({ description: "Get one game with its files \u2014 and more art than you need here." }, /description.*English/);
  hasProblem({ description: "Get a game." }, /description.*40/);
  hasProblem({ description: "Get a game. ".repeat(20) }, /description.*200/);
  hasProblem({ title: "" }, /title/);
});

test("input is a JSON Schema object whose arguments carry a type and a description", () => {
  hasProblem({ input: undefined }, /input/);
  hasProblem({ input: { type: "array" } }, /input.*object/);
  hasProblem({ input: { type: "object", properties: { q: { type: "string" } } } }, /argument q.*description/);
  hasProblem({ input: { type: "object", properties: { q: { description: "Name, file name or title id" } } } }, /argument q.*type/);
  hasProblem({ input: { type: "object", properties: { q: { type: "string", description: "이름으로 찾습니다. 한국어는 안 됩니다." } } } }, /argument q.*English/);
  hasProblem({ input: { type: "object", properties: {}, required: ["q"] } }, /required.*q/);
  // About 80 characters, and the lower bound is the firm one: shorter descriptions make agents pick the wrong tool.
  hasProblem({ input: { type: "object", properties: { q: { type: "string", description: "Name or title id" } } } }, /argument q description must be at least 40/);
  assert.deepEqual(problemsOf({ input: { type: "object", properties: { q: { type: "string", description: "Name, file name or 16 hex digit title id" } } } }), []);
  hasProblem({ input: { type: "object", properties: {}, $schema: "x" } }, /input.*\$schema/);
  // Obvious paging names need no description (ServiceNow measured that they only cost tokens).
  assert.deepEqual(problemsOf({ input: { type: "object", properties: { page: { type: "integer" }, perPage: { type: "integer" } } } }), []);
  assert.deepEqual(problemsOf({ input: { type: "object", properties: {} } }), []);
});

test("plan_id and confirm are injected for destructive tools, never declared", () => {
  hasProblem({
    safety: "destructive", http: { method: "POST", path: "/admin/api/inbox/x/remove" },
    input: { type: "object", properties: { plan_id: { type: "string" } } },
  }, /plan_id.*reserved/);
});

test("safety is read, write or destructive and access never sits below what safety needs", () => {
  hasProblem({ safety: "dangerous" }, /safety/);
  hasProblem({ safety: "write", http: { method: "POST", path: "/admin/api/descriptions/:id" }, access: "read" }, /access/);
  hasProblem({ safety: "destructive", http: { method: "POST", path: "/admin/api/inbox/:id/remove" }, access: "manage" }, /access/);
  hasProblem({ access: "root" }, /access/);
  assert.equal(defineCapability({ ...base(), safety: "write", http: { method: "POST", path: "/admin/api/descriptions/:id" } }).access, "manage");
  assert.equal(defineCapability({ ...base(), safety: "destructive", http: { method: "POST", path: "/admin/api/inbox/:id/remove" } }).access, "full");
  assert.equal(defineCapability({ ...base(), access: "full" }).access, "full");
});

test("a GET route never backs a tool that changes something", () => {
  hasProblem({ safety: "write" }, /GET/);
});

test("http names a method and an absolute path", () => {
  hasProblem({ http: { method: "FETCH", path: "/admin/api/x" } }, /http/);
  hasProblem({ http: { method: "GET", path: "admin/api/x" } }, /http/);
});

test("handler is a function", () => {
  hasProblem({ handler: "nope" }, /handler/);
});

// Token reach comes from what the server enforces: auth-guard's TOKEN_PATHS and admin-page's
// tokenBlocked(). Nothing here repeats them by hand. capability-token-reach.test.js checks it
// against real requests.
test("token reach follows TOKEN_PATHS and tokenBlocked()", () => {
  assert.equal(tokenReach({ method: "GET", path: "/admin/api/stats" }), true);
  assert.equal(tokenReach({ method: "POST", path: "/admin/api/descriptions/:id" }), true);
  assert.equal(tokenReach({ method: "POST", path: "/admin/api/users" }), false, "accounts are token-blocked");
  assert.equal(tokenReach({ method: "POST", path: "/admin/api/library/files/remove" }), false);
  assert.equal(tokenReach({ method: "GET", path: "/admin/api/users" }), true, "TOKEN_BLOCKED_RE only stops writes");
  assert.equal(tokenReach({ method: "GET", path: "/admin/api/tokens" }), false, "but the token list is not read with a token");
  assert.equal(tokenReach({ method: "GET", path: "/api/art/x" }), false, "outside TOKEN_PATHS");
  assert.equal(tokenReach({ method: "GET", path: "/shop.json" }), true);
});

test("a route tokens may never use is not a tool, whatever token says", () => {
  const write = { safety: "write", http: { method: "POST", path: "/admin/api/users" } };
  hasProblem(write, /may never do.*OPT_OUT as token-blocked/);
  hasProblem({ ...write, token: false }, /may never do/);
  hasProblem({ ...write, token: true }, /may never do/);
  hasProblem({ http: { method: "GET", path: "/admin/api/tokens" } }, /may never do/);
});

test("token: true outside TOKEN_PATHS is refused, token: false narrows", () => {
  hasProblem({ http: { method: "GET", path: "/api/shop/info" }, token: true }, /outside TOKEN_PATHS/);
  assert.equal(defineCapability({ ...base(), http: { method: "GET", path: "/api/shop/info" } }).token, false);
  assert.equal(defineCapability({ ...base(), token: false }).token, false);
});

test("a route blocked for some parameter values needs an enum without them, or token: false", () => {
  const move = (kind) => ({
    safety: "write", http: { method: "POST", path: "/admin/api/content/:kind/move" },
    input: { type: "object", properties: { kind: { type: "string", description: "Which kind of item to move to another game", ...kind } } },
  });
  hasProblem(move({}), /refuses tokens on \/admin\/api\/content\/patch\/move.*enum.*token: false/);
  hasProblem(move({ enum: ["homebrew", "patch"] }), /refuses tokens/);
  assert.equal(defineCapability({ ...base(), ...move({ enum: ["homebrew", "save"] }) }).token, true);
  assert.equal(defineCapability({ ...base(), ...move({}), token: false }).token, false);
});

test("without http the token field must be given", () => {
  hasProblem({ http: undefined }, /token/);
  assert.deepEqual(problemsOf({ http: undefined, token: false }), []);
});

test("a token capability on the settings route may not take a TOKEN_LOCKED setting", () => {
  const locked = TOKEN_LOCKED[0];
  const settings = {
    safety: "write", http: { method: "POST", path: "/admin/api/server-settings" },
    input: { type: "object", properties: { [locked]: { type: "string", description: "A setting an automation token may never change" } } },
  };
  hasProblem(settings, new RegExp(`${locked}.*TOKEN_LOCKED`));
  assert.deepEqual(problemsOf({ ...settings, token: false }), []);
});

test("defineCapability throws with every problem and the id", () => {
  assert.throws(() => defineCapability({ ...base(), area: "x", safety: "y" }), (err) => /game_get/.test(err.message) && /area/.test(err.message) && /safety/.test(err.message));
});

test("the registry refuses duplicate ids and two capabilities on one route", () => {
  const a = defineCapability(base());
  assert.throws(() => buildRegistry([a, a]), /duplicate id game_get/);
  const b = defineCapability({ ...base(), id: "game_get_again" });
  assert.throws(() => buildRegistry([a, b]), /GET \/admin\/api\/library\/browse/);
});

test("the registry lists tools per token level", () => {
  const read = defineCapability(base());
  const write = defineCapability({ ...base(), id: "game_meta_set", safety: "write", http: { method: "POST", path: "/admin/api/descriptions/:id" } });
  const hidden = defineCapability({ ...base(), id: "game_hidden", http: undefined, token: false });
  const reg = buildRegistry([read, write, hidden]);
  assert.deepEqual(reg.toolsFor("read").map((c) => c.id), ["game_get"]);
  assert.deepEqual(reg.toolsFor("manage").map((c) => c.id), ["game_get", "game_meta_set"]);
  assert.equal(reg.byId("game_meta_set"), write);
  assert.equal(reg.byRoute("POST /admin/api/descriptions/:id"), write);
  assert.equal(reg.byId("nope"), undefined);
});

test("the shipped registry builds", () => {
  assert.ok(Array.isArray(registry.all));
  for (const cap of registry.all) assert.deepEqual(capabilityProblems(cap), [], cap.id);
});
