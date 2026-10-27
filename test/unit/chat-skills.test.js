import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const { DEFAULT_TIERS } = await import("../../src/chat/policy.js");

const ROOT = new URL("../../src/chat/skills/", import.meta.url).pathname;
const names = readdirSync(ROOT, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);

function parse(text) {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  assert.ok(m, "a skill starts with a --- frontmatter block");
  const meta = Object.fromEntries(m[1].split("\n").map((l) => [l.slice(0, l.indexOf(":")), l.slice(l.indexOf(":") + 1).trim()]));
  return { meta, body: m[2] };
}

test("there is at least one shipped skill", () => {
  assert.ok(names.length > 0);
});

for (const name of names) {
  const { meta, body } = parse(readFileSync(path.join(ROOT, name, "SKILL.md"), "utf8"));

  test(`${name}: name matches its folder and the description is short`, () => {
    assert.equal(meta.name, name);
    assert.match(meta.name, /^[a-z0-9]+(-[a-z0-9]+)*$/);
    assert.ok(meta.description && meta.description.length <= 300, "the description is always in context, keep it short");
  });

  test(`${name}: every tool it names has a tier, so it cannot send the model to a tool chat does not offer`, () => {
    const tools = [...new Set([...body.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)].map((x) => x[1]))];
    assert.ok(tools.length > 0);
    const unknown = tools.filter((t) => !Object.hasOwn(DEFAULT_TIERS, t));
    assert.deepEqual(unknown, [], `not in src/chat/policy.js: ${unknown.join(", ")}`);
  });

  test(`${name}: it names no blocked tool`, () => {
    const blocked = Object.entries(DEFAULT_TIERS).filter(([, t]) => t === "blocked").map(([id]) => id);
    assert.deepEqual(blocked.filter((id) => body.includes(`\`${id}\``)), []);
  });

  test(`${name}: no dash joins sentences`, () => {
    assert.doesNotMatch(body + meta.description, /[—–]/);
  });
}
