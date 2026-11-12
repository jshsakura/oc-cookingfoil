import { test } from "node:test";
import assert from "node:assert/strict";
import { gameReasons } from "../../src/routes/admin/metadata-api.js";

const ID = "0100000000010000";

test("a game with a Korean name and a readable one needs nothing", () => {
  assert.deepEqual(gameReasons({ titleId: ID, name: "Example Quest" }, { ko: "예시 퀘스트", en: "Example Quest" }), []);
});

test("a replacement character in the name marks it garbled", () => {
  assert.deepEqual(gameReasons({ titleId: ID, name: "Ex�mple" }, { ko: "예시" }), ["garbled"]);
});

test("a game named only by its title ID, or not at all, has no name", () => {
  assert.deepEqual(gameReasons({ titleId: ID, name: ID.toLowerCase() }, { ko: "예시" }), ["noName"]);
  assert.deepEqual(gameReasons({ titleId: ID, name: "" }, { ko: "예시" }), ["noName"]);
});

test("a game without a Korean name says so after any broken name", () => {
  assert.deepEqual(gameReasons({ titleId: ID, name: "" }, null), ["noName", "noKo"]);
  assert.deepEqual(gameReasons({ titleId: ID, name: "Example Quest" }, { en: "Example Quest" }), ["noKo"]);
});
