import { test } from "node:test";
import assert from "node:assert/strict";

const { createEventBus, PAYLOAD_MAX_BYTES } = await import("../../src/realtime/event-bus.js");

const USER = { account: "alice", admin: false };
const OTHER = { account: "bob", admin: false };
const ADMIN = { account: "owner", admin: true };
const all = { all: true };

/** Subscribes `who` and returns what it receives. */
const listen = (bus, who) => {
  const got = [];
  bus.subscribe(who, (e) => got.push(e));
  return got;
};

test("an event reaches the pages connected now, with a topic and a payload", () => {
  const bus = createEventBus();
  const got = listen(bus, USER);
  bus.publish({ topic: "notice", audience: all, payload: { title: "hi" } });
  assert.deepEqual(got, [{ topic: "notice", payload: { title: "hi" } }]);
});

test("nothing is kept: a page that subscribes later sees nothing of the past", () => {
  const bus = createEventBus();
  bus.publish({ topic: "notice", audience: all, payload: { n: 1 } });
  assert.deepEqual(listen(bus, USER), []);
});

test("the audience decides who is told: everyone, admins, or named accounts", () => {
  const bus = createEventBus();
  const [u, o, a] = [USER, OTHER, ADMIN].map((w) => listen(bus, w));
  bus.publish({ topic: "t", audience: all, payload: { k: "all" } });
  bus.publish({ topic: "t", audience: { admin: true }, payload: { k: "admins" } });
  bus.publish({ topic: "t", audience: { accounts: ["alice"] }, payload: { k: "alice" } });
  assert.deepEqual(u.map((e) => e.payload.k), ["all", "alice"]);
  assert.deepEqual(o.map((e) => e.payload.k), ["all"]);
  assert.deepEqual(a.map((e) => e.payload.k), ["all", "admins"]);
});

test("the admin extra is merged for admins only", () => {
  const bus = createEventBus();
  const [u, a] = [USER, ADMIN].map((w) => listen(bus, w));
  bus.publish({ topic: "t", audience: all, payload: { what: "a file" }, adminExtra: { by: "alice" } });
  assert.deepEqual(u[0].payload, { what: "a file" });
  assert.deepEqual(a[0].payload, { what: "a file", by: "alice" });
});

test("an empty or unknown audience is refused, never read as everyone", () => {
  const bus = createEventBus();
  const got = listen(bus, USER);
  for (const audience of [undefined, null, {}, { accounts: [] }, { all: false }, { everyone: true }, "all"]) {
    assert.throws(() => bus.publish({ topic: "t", audience, payload: {} }), /audience/);
  }
  assert.deepEqual(got, []);
});

test("a bad topic or an oversized or non object payload is refused", () => {
  const bus = createEventBus();
  for (const topic of ["", "Upper", "1x", "has space", "x".repeat(40), null]) {
    assert.throws(() => bus.publish({ topic, audience: all, payload: {} }), /topic/);
  }
  for (const payload of [null, [], "x", 5]) assert.throws(() => bus.publish({ topic: "t", audience: all, payload }), /payload/);
  assert.throws(() => bus.publish({ topic: "t", audience: all, payload: { big: "x".repeat(PAYLOAD_MAX_BYTES) } }), /payload/);
  assert.throws(() => bus.publish({ topic: "t", audience: all, payload: {}, adminExtra: [] }), /adminExtra/);
});

test("unsubscribing stops delivery, and a listener that throws does not stop the others", () => {
  const bus = createEventBus();
  const got = [];
  const off = bus.subscribe(USER, (e) => got.push(e));
  bus.subscribe(USER, () => { throw new Error("boom"); });
  const last = listen(bus, USER);
  bus.publish({ topic: "t", audience: all, payload: { n: 1 } });
  off();
  bus.publish({ topic: "t", audience: all, payload: { n: 2 } });
  assert.equal(got.length, 1);
  assert.equal(last.length, 2);
});
