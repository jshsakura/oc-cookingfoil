import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const { createChatStore, CONVERSATION_ID_RE } = await import("../../src/chat/session-store.js");

const fresh = () => createChatStore({ dir: mkdtempSync(path.join(tmpdir(), "cook-chat-store-")) });

test("a conversation keeps what was appended, in order, after a reload", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cook-chat-store-"));
  const id = createChatStore({ dir }).create("account-a");
  const store = createChatStore({ dir });
  store.append("account-a", id, { role: "user", content: "one" });
  store.append("account-a", id, { role: "assistant", content: "two" });
  const again = createChatStore({ dir });
  assert.deepEqual(again.load("account-a", id).map((e) => e.content), ["one", "two"]);
});

test("another account cannot read, append to or list a conversation", () => {
  const store = fresh();
  const id = store.create("account-a");
  store.append("account-a", id, { role: "user", content: "private" });
  assert.equal(store.load("account-b", id), null);
  assert.throws(() => store.append("account-b", id, { role: "user", content: "x" }), /no such conversation/);
  assert.deepEqual(store.list("account-b"), []);
  assert.equal(store.list("account-a").length, 1);
});

test("an account id that looks like a path stays inside the store", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cook-chat-store-"));
  const store = createChatStore({ dir });
  for (const evil of ["../outside", "a/b", "..", "a\0b", "C:\\x"]) {
    const id = store.create(evil);
    store.append(evil, id, { role: "user", content: "x" });
    assert.equal(store.load(evil, id).length, 1);
  }
  assert.deepEqual(readdirSync(path.dirname(dir)).filter((n) => n === "outside"), []);
  assert.ok(readdirSync(dir).every((n) => /^[A-Za-z0-9_-]+$/.test(n)), "account folders are encoded");
});

test("a conversation id from the client is checked before it touches the disk", () => {
  const store = fresh();
  for (const bad of ["../x", "", "a/b", "x".repeat(200), null, undefined, 7]) {
    assert.equal(store.load("account-a", bad), null);
    assert.throws(() => store.append("account-a", bad, { role: "user", content: "x" }), /no such conversation/);
  }
  assert.match(store.create("account-a"), CONVERSATION_ID_RE);
});

test("a half-written last line from a crash is skipped, earlier lines survive", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cook-chat-store-"));
  const store = createChatStore({ dir });
  const id = store.create("account-a");
  store.append("account-a", id, { role: "user", content: "kept" });
  const accountDir = path.join(dir, readdirSync(dir)[0]);
  appendFileSync(path.join(accountDir, `${id}.jsonl`), '{"role":"user","content":"tor');
  assert.deepEqual(store.load("account-a", id).map((e) => e.content), ["kept"]);
  store.append("account-a", id, { role: "user", content: "after" });
  assert.deepEqual(store.load("account-a", id).map((e) => e.content), ["kept", "after"]);
});

test("list returns newest first with a title from the first user message", () => {
  const store = fresh();
  const a = store.create("account-a", { now: 1000 });
  store.append("account-a", a, { role: "user", content: "first topic" }, { now: 1000 });
  const b = store.create("account-a", { now: 2000 });
  store.append("account-a", b, { role: "user", content: "second topic" }, { now: 2000 });
  const rows = store.list("account-a");
  assert.deepEqual(rows.map((r) => r.id), [b, a]);
  assert.deepEqual(rows.map((r) => r.title), ["second topic", "first topic"]);
});

test("removing a conversation deletes only that account's own chat history", () => {
  const store = fresh();
  const a = store.create("account-a");
  const b = store.create("account-b");
  assert.equal(store.remove("account-b", a), false);
  assert.equal(store.remove("account-a", a), true);
  assert.equal(store.load("account-a", a), null);
  assert.deepEqual(store.load("account-b", b), []);
});

test("an entry that is not a plain message is refused", () => {
  const store = fresh();
  const id = store.create("account-a");
  for (const bad of [null, "x", [], { role: "root", content: "x" }, { role: "user" }]) {
    assert.throws(() => store.append("account-a", id, bad), /entry/);
  }
});

test("a fresh store on an empty directory lists nothing", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cook-chat-store-"));
  writeFileSync(path.join(dir, "stray.txt"), "x");
  assert.deepEqual(createChatStore({ dir }).list("account-a"), []);
});
