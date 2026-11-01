import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// The generated catalog the admin retro-settings page offers: real libretro
// option keys with their real value lists, one entry per shipped core.
const catalog = JSON.parse(
  fs.readFileSync(new URL("../../src/retro/data/core-options.json", import.meta.url), "utf8"),
);
const cores = Object.entries(catalog.cores);

function option(coreId, key) {
  return catalog.cores[coreId].options.find((o) => o.key === key);
}

test("every core option has a plain key, at least one value and a default that is one of them", () => {
  assert.ok(cores.length > 0);
  for (const [id, core] of cores) {
    assert.ok(core.options.length > 0, `${id} has options`);
    for (const o of core.options) {
      assert.match(o.key, /^[a-z0-9_-]+$/i, `${id}: key ${o.key}`);
      assert.ok(o.values.length > 0, `${id}.${o.key} has values`);
      assert.ok(
        o.values.some((v) => v.value === o.default),
        `${id}.${o.key} default ${o.default} is one of its values`,
      );
    }
  }
});

test("option keys are unique within a core", () => {
  for (const [id, core] of cores) {
    const keys = core.options.map((o) => o.key);
    assert.equal(new Set(keys).size, keys.length, `${id} has duplicate keys`);
  }
});

test("scummvm hardware acceleration is a disabled/enabled choice that defaults to enabled", () => {
  const o = option("scummvm", "scummvm_video_hw_acceleration");
  assert.deepEqual(o.values.map((v) => v.value), ["disabled", "enabled"]);
  assert.equal(o.default, "enabled");
});

test("mupen64plus cpu core offers the three backends and defaults to the dynarec", () => {
  const o = option("mupen64plus_next", "mupen64plus-cpucore");
  assert.deepEqual(o.values.map((v) => v.value), ["pure_interpreter", "cached_interpreter", "dynamic_recompiler"]);
  assert.equal(o.default, "dynamic_recompiler");
});

test("snes9x region offers auto, ntsc and pal", () => {
  const o = option("snes9x", "snes9x_region");
  assert.deepEqual(o.values.map((v) => v.value), ["auto", "ntsc", "pal"]);
  assert.equal(o.default, "auto");
});
