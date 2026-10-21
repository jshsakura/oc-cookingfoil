import { test } from "node:test";
import assert from "node:assert/strict";
import { createIdentifier, nameDisagrees, pickIdentity } from "../../src/meta/file-identity.js";

const id = (titleId, kind = "base") => ({ titleId, version: 0, kind, baseTitleId: titleId });

test("a cartridge's identity is its game, with every title it carries listed", () => {
  const p = pickIdentity([id("0100000000010800", "update"), null, id("0100000000010000")]);
  assert.equal(p.titleId, "0100000000010000");
  assert.deepEqual(p.titleIds, ["0100000000010800", "0100000000010000"]);
  assert.equal(pickIdentity([null]), null);
});

test("a name disagrees only when it carries a title id the content does not", () => {
  const p = pickIdentity([id("0100000000010000")]);
  assert.equal(nameDisagrees("a/Game [0100000000010000][v0].nsp", p), false);
  assert.equal(nameDisagrees("a/Game [0100000000020000][v0].nsp", p), true);
  assert.equal(nameDisagrees("a/Game.nsp", p), false);
  assert.equal(nameDisagrees("a/Game [0100000000020000].nsp", null), false);
});

test("the content answers first, then what the library check already read, then the name, then a ticket", async () => {
  const file = { abs: "/g/x [0100000000020000][v0].nsp", rel: "x [0100000000020000][v0].nsp", size: 1, mtimeMs: 1 };
  let reads = 0;
  const fromCnmt = createIdentifier({ readIdentity: async () => { reads++; return id("0100000000010000"); } });
  assert.equal((await fromCnmt.identify(file)).source, "cnmt");
  await fromCnmt.identify(file);
  assert.equal(reads, 1, "an unchanged file is not read again");

  const fromKnown = createIdentifier({ known: () => id("0100000000030000"), readIdentity: async () => { throw new Error("not read"); } });
  assert.equal((await fromKnown.identify(file)).id.titleId, "0100000000030000");

  const fromName = createIdentifier({ readIdentity: async () => null });
  assert.deepEqual(await fromName.identify(file), { size: 1, mtimeMs: 1, id: { titleId: "0100000000020000", version: 0, kind: "base", baseTitleId: "0100000000020000" }, source: "name" });

  const fromTicket = createIdentifier({ readIdentity: async () => null, readTicketNames: async () => ["0100000000050000" + "0".repeat(16) + ".tik"] });
  assert.equal((await fromTicket.identify({ ...file, rel: "plain.nsp" })).source, "ticket");
});
