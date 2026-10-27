import { test } from "node:test";
import assert from "node:assert/strict";

const { cleanCards, CARD_MAX } = await import("../../src/chat/cards.js");
const { runTurn } = await import("../../src/chat/agent-loop.js");

const BASE = "0100000000010000";
const card = (over = {}) => ({
  kind: "switch", id: BASE, name: "Test Game", platform: "Nintendo Switch", size: 1234,
  korean: { patch: true, ui: false }, icon: `/api/library/icon/${BASE}?v=abc`, sendable: true, ...over,
});

test("a well formed card passes through unchanged", () => {
  assert.deepEqual(cleanCards([card()]), [card()]);
});

test("a card from an outside tool cannot bring a picture from another site or an id that is not a game", () => {
  const out = cleanCards([
    card({ icon: "https://tracker.example.com/pixel.png" }),
    card({ icon: "//tracker.example.com/pixel.png" }),
    card({ icon: "/api/../../etc/passwd x" }),
    card({ id: "not-an-id" }),
    card({ kind: "other" }),
    { kind: "switch", id: BASE },
  ]);
  assert.deepEqual(out.map((c) => c.icon), [null, null, null], "the bad pictures lose only the picture; the bad ids and kinds are dropped");
});

test("a retro card is never offered the add button, whatever it claims", () => {
  const [c] = cleanCards([{ ...card({ kind: "retro", id: "gba-0123456789" }), sendable: true }]);
  assert.equal(c.sendable, false);
});

test("at most CARD_MAX cards and the fields are clipped and typed", () => {
  const many = Array.from({ length: CARD_MAX + 5 }, () => card({ name: "x".repeat(500), size: "big" }));
  const out = cleanCards(many);
  assert.equal(out.length, CARD_MAX);
  assert.equal(out[0].name.length, 120);
  assert.equal(out[0].size, null);
  assert.deepEqual(cleanCards("nope"), []);
});

const calls = (...cs) => [{ type: "tool_calls", calls: cs.map(([id, name, args]) => ({ id, name, arguments: JSON.stringify(args) })) }, { type: "done" }];
const text = (t) => [{ type: "text", delta: t }, { type: "done" }];

function scripted(...scripts) {
  const sent = [];
  const llm = async function* (request) {
    sent.push(structuredClone(request.messages));
    for (const e of scripts[sent.length - 1] ?? [{ type: "done" }]) yield e;
  };
  return { llm, sent };
}
const host = (result) => ({ tools: async () => [], call: async () => ({ status: "done", result }) });

test("cards in a tool result reach the screen and the stored row, and the model gets ids and names instead", async () => {
  const { llm, sent } = scripted(calls(["c1", "games", { action: "games_show", args: { ids: BASE } }]), text("here"));
  const seen = [];
  const r = await runTurn({ llm, host: host({ shown: 1, cards: [card()], skipped: [] }), messages: [{ role: "user", content: "show" }], ctx: {}, onEvent: (e) => seen.push(e) });

  const event = seen.find((e) => e.type === "cards");
  assert.deepEqual(event.cards, [card()]);
  const stored = r.added.find((m) => m.role === "tool");
  assert.deepEqual(stored.cards, [card()], "a reload draws the cards again");
  const modelSaw = JSON.parse(sent[1].at(-1).content);
  assert.equal(modelSaw.cards, undefined, "the card fields are not sent back to the model");
  assert.deepEqual(modelSaw.shown, [{ id: BASE, name: "Test Game", platform: "Nintendo Switch" }]);
  assert.match(modelSaw.note, /already sees/);
});

test("a result without cards is stored as before", async () => {
  const { llm } = scripted(calls(["c1", "games", { action: "games_search", args: {} }]), text("ok"));
  const r = await runTurn({ llm, host: host({ total: 0, items: [] }), messages: [{ role: "user", content: "x" }], ctx: {} });
  assert.deepEqual(r.added[1], { role: "tool", tool_call_id: "c1", content: '{"total":0,"items":[]}' });
});

test("junk under cards is dropped and the result still reaches the model", async () => {
  const { llm, sent } = scripted(calls(["c1", "x", { action: "a" }]), text("ok"));
  const seen = [];
  const r = await runTurn({ llm, host: host({ cards: [{ kind: "switch", id: "bad" }] }), messages: [{ role: "user", content: "x" }], ctx: {}, onEvent: (e) => seen.push(e) });
  assert.equal(seen.some((e) => e.type === "cards"), false);
  assert.equal(r.added.find((m) => m.role === "tool").cards, undefined);
  assert.equal(JSON.parse(sent[1].at(-1).content).cards, undefined, "what failed the check never reaches the model either");
});
