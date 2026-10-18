import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// The dashboard script is served from a template literal, so a regex escape
// written with one backslash reaches the browser without it (\d becomes d).
const { DASHBOARD_SCRIPT } = await import("../../src/routes/admin/dashboard-script.js");

test("the served 2FA confirmation accepts a six-digit code", () => {
  const literal = DASHBOARD_SCRIPT.match(/async function confirmTfa\(\)\{[^\n]*\n\s*if\(!(\/[^\n]*?\/)\.test\(code\)\)/)?.[1];
  assert.ok(literal, "confirmTfa checks the code with a regex");
  const re = new Function(`return ${literal}`)();
  assert.equal(re.test("123456"), true, "a real code passes the check");
  assert.equal(re.test("12345a"), false);
});

// Every module that serves a page or script from a template literal.
const SERVED = fs.readdirSync(new URL("../../src", import.meta.url), { recursive: true })
  .filter((f) => f.endsWith(".js"))
  .map((f) => new URL(`../../src/${f}`, import.meta.url))
  .filter((u) => /\/\* js \*\/|<script>/.test(fs.readFileSync(u, "utf8")));

test("served page and script sources have no single-backslash regex escapes", () => {
  assert.ok(SERVED.some((u) => u.pathname.endsWith("dashboard-script.js")));
  const lone = SERVED.flatMap((u) => fs.readFileSync(u, "utf8").split("\n")
    .map((line, i) => [`${u.pathname.split("/src/")[1]}:${i + 1}`, line])
    .filter(([, line]) => /(?<!\\)\\[dDsSwWbB]/.test(line)).map(([where]) => where));
  assert.deepEqual(lone, [], "inside a template literal write two backslashes (\\\\d), or the browser gets d");
});
