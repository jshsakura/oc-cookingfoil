import { test } from "node:test";
import assert from "node:assert/strict";
import { readPluginManifest } from "../../src/meta/homebrew-vita-plugin.js";

// What a plugin folder's manifest may tell a Vita: anything a console would write somewhere it should not, or add
// to its config.txt as more than one section line, is refused.
const names = ["a.suprx", "k.skprx"];
const read = (over) => readPluginManifest({ file: "a.suprx", sections: ["*main"], ...over }, names);

test("a plain manifest gets the defaults: ur0:tai/<file>, kernel by extension, not required", () => {
  assert.deepEqual(read({}), { file: "a.suprx", sections: ["*main"], install_path: "ur0:tai/a.suprx", kernel: false, required: false, name: null, description: null, display_version: null, source_url: null });
  assert.equal(readPluginManifest({ file: "k.skprx", sections: ["*KERNEL"] }, names).kernel, true);
  assert.deepEqual(read({ sections: ["*main", "*NPXS10015"] }).sections, ["*main", "*NPXS10015"]);
  assert.equal(read({ install_path: "ux0:tai/sub/a.suprx" }).install_path, "ux0:tai/sub/a.suprx");
});

test("an install path outside ur0:tai/ or ux0:tai/, or climbing out of it, is refused", () => {
  for (const p of ["ur0:tai/../a.suprx", "ux0:tai/./a.suprx", "ur0:data/a.suprx", "ux0:app/X/a.suprx", "ur0:tai/a.skprx", "ur0:tai/", "/ur0:tai/a.suprx", "ur0:tai\\a.suprx", "os0:tai/a.suprx"]) {
    assert.deepEqual(read({ install_path: p }), { error: "install_path" }, p);
  }
});

test("a file not beside the manifest, sections that are not section lines, and flags that are not booleans are refused", () => {
  for (const f of ["../a.suprx", "missing.suprx", "a.vpk", ".suprx", "sub/a.suprx"]) assert.deepEqual(read({ file: f }), { error: "file" }, f);
  for (const s of [[], "*main", ["main"], ["*main\n*KERNEL"], ["*main", "*main"], ["* main"]]) assert.deepEqual(read({ sections: s }), { error: "sections" }, JSON.stringify(s));
  assert.deepEqual(read({ required: "yes" }), { error: "required" });
  assert.deepEqual(read({ kernel: 1 }), { error: "kernel" });
});

test("words and links that cannot be shown safely are dropped, not passed on", () => {
  const p = read({ name: "x".repeat(81), description: "line\nbreak", display_version: " 2.1.0 ", source_url: "javascript:alert(1)" });
  assert.equal(p.name, null);
  assert.equal(p.description, null);
  assert.equal(p.display_version, "2.1.0");
  assert.equal(p.source_url, null);
  assert.equal(read({ source_url: "https://example.com/p" }).source_url, "https://example.com/p");
});
