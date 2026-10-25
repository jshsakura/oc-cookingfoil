import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { TOP_WORDS } from "../../src/routes/admin/top-i18n.js";

const here = dirname(fileURLToPath(import.meta.url));
const adminDir = join(here, "..", "..", "src", "routes", "admin");

// The reference audit mirrors how the pages look keys up: direct calls with
// either quote style, the per-panel prefix wrappers, and the data-top
// attributes the shell fills. Dynamic sites (a wrapper building 't.'+k) are
// collected as families and checked as a whole against English, the
// completeness reference.
const wrappers = { loT: "lo.", rpT: "rp.", trT: "t." };
function collectReferences() {
  const literal = new Map(); // key -> files
  const families = new Map(); // prefix -> files
  const note = (map, k, f) => {
    if (!map.has(k)) map.set(k, new Set());
    map.get(k).add(f);
  };
  for (const f of readdirSync(adminDir).filter((x) => x.endsWith(".js"))) {
    const src = readFileSync(join(adminDir, f), "utf8");
    for (const q of ["'", '"']) {
      const call = new RegExp(
        `(?:topText|topFill|topPh|topN|top)\\(\\s*\\${q}([a-zA-Z0-9_.-]+)\\${q}\\s*[,)+]`,
        "g",
      );
      for (const m of src.matchAll(call)) {
        if (m[1].endsWith(".")) note(families, m[1], f);
        else note(literal, m[1], f);
      }
      for (const w of Object.keys(wrappers)) {
        const wrapped = new RegExp(`${w}\\(\\s*\\${q}([a-zA-Z0-9_.-]+)\\${q}`, "g");
        for (const m of src.matchAll(wrapped)) {
          const key = wrappers[w] + m[1];
          if (key.endsWith(".")) note(families, key, f);
          else note(literal, key, f);
        }
      }
      const attr = new RegExp(`data-top(?:-ph)?=\\${q}([a-zA-Z0-9_.-]+)\\${q}`, "g");
      for (const m of src.matchAll(attr)) note(literal, m[1], f);
    }
  }
  return { literal, families };
}

const { literal, families } = collectReferences();
const langs = Object.keys(TOP_WORDS);

test("the audit sees the pages' references at all", () => {
  assert.ok(literal.size > 350, `literal references look too few: ${literal.size}`);
  assert.ok(families.size > 5, `dynamic families look too few: ${families.size}`);
});

test("every language defines the same key set as English", () => {
  const ref = Object.keys(TOP_WORDS.en).sort().join("|");
  for (const l of langs) {
    if (l === "en") continue;
    const cur = Object.keys(TOP_WORDS[l]).sort().join("|");
    const missing = Object.keys(TOP_WORDS.en).filter((k) => !TOP_WORDS[l][k]);
    const extra = Object.keys(TOP_WORDS[l]).filter((k) => !TOP_WORDS.en[k]);
    assert.deepEqual(
      { missing, extra },
      { missing: [], extra: [] },
      `${l} differs from en: missing [${missing.join(", ")}], extra [${extra.join(", ")}] (sets equal: ${cur === ref})`,
    );
  }
});

test("every key the pages reference literally exists in every language", () => {
  const problems = [];
  for (const [k, files] of [...literal].sort()) {
    const missing = langs.filter((l) => !TOP_WORDS[l][k]);
    if (missing.length) problems.push(`${k} (missing in ${missing.join(", ")}; used in ${[...files].join(", ")})`);
  }
  assert.deepEqual(problems, [], `referenced-but-undefined keys:\n  ${problems.join("\n  ")}`);
});

test("every dynamic key family the pages build exists whole in every language", () => {
  const problems = [];
  for (const [prefix, files] of [...families].sort()) {
    const family = Object.keys(TOP_WORDS.en).filter((k) => k.startsWith(prefix));
    if (!family.length) {
      problems.push(`family ${prefix} has no English keys (built in ${[...files].join(", ")})`);
      continue;
    }
    for (const k of family) {
      const missing = langs.filter((l) => !TOP_WORDS[l][k]);
      if (missing.length) problems.push(`${k} (missing in ${missing.join(", ")}; family ${prefix} built in ${[...files].join(", ")})`);
    }
  }
  assert.deepEqual(problems, [], `dynamic families with gaps:\n  ${problems.join("\n  ")}`);
});

test("every translation keeps the placeholders of the English string", () => {
  const ph = (s) => (s.match(/\{[a-z-]+\}/g) || []).sort().join(",");
  const problems = [];
  for (const k of Object.keys(TOP_WORDS.en).sort()) {
    const want = ph(TOP_WORDS.en[k]);
    for (const l of langs) {
      if (l === "en") continue;
      if (ph(TOP_WORDS[l][k]) !== want) {
        problems.push(`${k} in ${l}: {${ph(TOP_WORDS[l][k])}} vs en {${want}}`);
      }
    }
  }
  assert.deepEqual(problems, [], `placeholder mismatches:\n  ${problems.join("\n  ")}`);
});
