import { test } from "node:test";
import assert from "node:assert/strict";
import { clientName, transferLine } from "../../src/helpers/transfer-log.js";

// The speed line a big game-file response leaves in the log.
test("a big response logs its size, time and speed with the client's name", () => {
  const line = transferLine({ bytes: 2048 * 1024 * 1024, ms: 160_000, range: false, client: "Tinfoil", file: "Game [0100000000010000][v0].nsz" });
  assert.equal(line, "transfer: 2048.0 MB in 160.0 s = 12.8 MB/s (full, Tinfoil) Game [0100000000010000][v0].nsz");
  assert.equal(transferLine({ bytes: 1024, ms: 10, range: true, client: "x", file: "a" }), null, "small ones are not logged");
});

test("the client is the first word of its User-Agent, nothing else", () => {
  assert.equal(clientName("Tinfoil/19.0 (Switch)"), "Tinfoil");
  assert.equal(clientName("CookingFoil/0.2.152"), "CookingFoil");
  assert.equal(clientName(""), "unknown");
  assert.equal(clientName("<script>"), "unknown");
});
