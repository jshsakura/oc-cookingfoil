// The shape of a download option as the client gets it: a window with a title, progress and failure texts,
// a flag for bytes that differ from the original, and an option that is shown greyed with its reason.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeDataDir, manifestOf, newRegistry, writePlugin } from "../support/plugin-fixtures.js";

process.env.COOK_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "option-shape-"));
const { createVariants } = await import("../../src/plugins/variants.js");

const T = (en, ko) => ({ en, ko });
const BODY = `
const T = (en, ko) => ({ en, ko });
export default {
  variants(item) {
    const make = {
      full: { id: "full", label: T("Install anyway", "그래도 설치"), note: T("note", "참고"), confirm: { title: T("Sure?", "진행할까요?"), body: T("Line one.\\nLine two.", "첫 줄.\\n둘째 줄.") }, progress: T("Preparing", "준비 중"), failed: T("Could not prepare", "준비하지 못했습니다"), hashesChange: true, query: { opt: "21.0.1" } },
      legacy: { id: "legacy", label: T("Old", "옛"), confirm: T("sure?", "확실합니까?"), query: { opt: "1" } },
      blocked: { id: "blocked", label: T("Not possible", "불가"), blocked: { title: T("Cannot", "불가"), body: T("Replace the keys.", "키를 교체해 주세요.") } },
      "blocked-with-query": { id: "b", label: T("x", "x"), blocked: { title: T("t", "t"), body: T("b", "b") }, query: { opt: "1" } },
      "half-dialog": { id: "h", label: T("x", "x"), confirm: { title: T("t", "t") }, query: { opt: "1" } },
      "bad-flag": { id: "f", label: T("x", "x"), hashesChange: "yes", query: { opt: "1" } },
      "bad-progress": { id: "p", label: T("x", "x"), progress: 5, query: { opt: "1" } },
      "unlisted-key": { id: "k", label: T("x", "x"), query: { other: "1" } },
    };
    return [make[item.file]].filter(Boolean);
  },
  async plan() { return { patches: [] }; },
};`;

let variants;
before(async () => {
  const d = makeDataDir();
  writePlugin(d, "shaper", { manifest: manifestOf("shaper", { provides: ["variant"], variantKeys: ["opt"] }), body: BODY });
  const env = newRegistry(d);
  await env.registry.init();
  await env.registry.setEnabled("shaper", true);
  variants = createVariants(env.registry);
});

const ask = async (file, lang = "en") => (await variants.list([{ file, abs: file, st: { size: 1, mtimeMs: 1 } }], { lang, facts: {}, clientVersion: null }))[file];

test("an option carries its window, progress and failure texts in the reader's language, and says its bytes change", async () => {
  assert.deepEqual(await ask("full", "ko"), [{
    id: "full", label: "그래도 설치", note: "참고",
    confirm: { title: "진행할까요?", body: "첫 줄.\n둘째 줄." },
    progress: "준비 중", failed: "준비하지 못했습니다", hashesChange: true, query: { opt: "21.0.1" },
  }]);
  assert.equal((await ask("full", "fr"))[0].confirm.title, "Sure?", "a language the plugin does not speak falls back to English");
});

test("an older plugin's single-text confirm still arrives as one string", async () => {
  assert.deepEqual(await ask("legacy", "ko"), [{ id: "legacy", label: "옛", confirm: "확실합니까?", query: { opt: "1" } }]);
});

test("a blocked option has a reason window and no query", async () => {
  assert.deepEqual(await ask("blocked", "ko"), [{ id: "blocked", label: "불가", blocked: { title: "불가", body: "키를 교체해 주세요." } }]);
});

test("an option that mixes the shapes or is malformed is left out", async () => {
  for (const file of ["blocked-with-query", "half-dialog", "bad-flag", "bad-progress", "unlisted-key"]) assert.deepEqual(await ask(file), [], file);
});
