import { test } from "node:test";
import assert from "node:assert/strict";

const { runTurn } = await import("../../src/chat/agent-loop.js");
const { LlmError } = await import("../../src/chat/llm.js");

const CTX = { account: "user-1", admin: false };
const user = (content) => [{ role: "user", content }];

/** An llm whose n-th call yields the n-th script (a list of events); records what it was sent. */
function scripted(...scripts) {
  const sent = [];
  const llm = async function* (request) {
    sent.push(structuredClone(request.messages));
    const script = scripts[sent.length - 1];
    if (script instanceof Error) throw script;
    for (const e of script ?? [{ type: "done" }]) yield e;
  };
  return { llm, sent };
}
const text = (t) => [{ type: "text", delta: t }, { type: "done" }];
const calls = (...cs) => [{ type: "tool_calls", calls: cs.map(([id, name, args]) => ({ id, name, arguments: typeof args === "string" ? args : JSON.stringify(args) })) }, { type: "done" }];
const host = (handler) => ({ tools: async () => [{ name: "games", description: "d", inputSchema: { type: "object" } }], call: async (ctx, req) => handler(ctx, req) });

test("a plain answer is one assistant message and the text is streamed", async () => {
  const { llm } = scripted(text("hello"));
  const seen = [];
  const r = await runTurn({ llm, host: host(() => null), messages: user("hi"), ctx: CTX, onEvent: (e) => seen.push(e) });
  assert.deepEqual(r.added, [{ role: "assistant", content: "hello" }]);
  assert.deepEqual(seen.filter((e) => e.type === "text").map((e) => e.delta), ["hello"]);
  assert.equal(seen.at(-1).type, "done");
});

test("a tool call is run through the host and its result goes back to the model", async () => {
  const { llm, sent } = scripted(calls(["c1", "games", { action: "games_search", args: { q: "x" } }]), text("found it"));
  const got = [];
  const r = await runTurn({ llm, host: host((ctx, req) => { got.push([ctx, req]); return { status: "done", result: { items: [1] } }; }), messages: user("find x"), ctx: CTX });
  assert.deepEqual(got[0], [CTX, { tool: "games", arguments: { action: "games_search", args: { q: "x" } } }]);
  assert.deepEqual(r.added.map((m) => m.role), ["assistant", "tool", "assistant"]);
  assert.deepEqual(r.added[0].tool_calls, [{ id: "c1", type: "function", function: { name: "games", arguments: '{"action":"games_search","args":{"q":"x"}}' } }]);
  assert.deepEqual(r.added[1], { role: "tool", tool_call_id: "c1", content: '{"items":[1]}' });
  assert.equal(sent[1].at(-1).role, "tool");
});

test("arguments that are not JSON go back as an error and the host is not called", async () => {
  const { llm } = scripted(calls(["c1", "games", "{broken"]), text("sorry"));
  let called = 0;
  const r = await runTurn({ llm, host: host(() => { called++; }), messages: user("x"), ctx: CTX });
  assert.equal(called, 0);
  assert.match(r.added[1].content, /not valid JSON/);
});

test("a call waiting for approval is reported to the screen and the model is told to wait", async () => {
  const { llm } = scripted(calls(["c1", "admin", { action: "settings_set" }]), text("I asked for approval"));
  const seen = [];
  const r = await runTurn({ llm, host: host(() => ({ status: "requested", id: "R".repeat(22), preview: { changes: "c" } })), messages: user("x"), ctx: CTX, onEvent: (e) => seen.push(e) });
  const ev = seen.find((e) => e.type === "approval");
  assert.deepEqual([ev.status, ev.id, ev.preview], ["requested", "R".repeat(22), { changes: "c" }]);
  assert.match(r.added[1].content, /waiting/i);
  assert.ok(!r.added[1].content.includes("preview"), "the model does not need the preview text again");
});

test("a refused call tells the model why, in few words", async () => {
  const { llm } = scripted(calls(["c1", "library", { action: "library_files_remove" }]), text("ok"));
  const r = await runTurn({ llm, host: host(() => ({ status: "denied", message: "library_files_remove is not available in chat" })), messages: user("x"), ctx: CTX });
  assert.equal(r.added[1].content, '{"error":"library_files_remove is not available in chat"}');
});

test("two tool calls in one step both run and each result keeps its own id", async () => {
  const { llm } = scripted(calls(["a", "games", { action: "one" }], ["b", "games", { action: "two" }]), text("done"));
  const r = await runTurn({ llm, host: host((ctx, req) => ({ status: "done", result: req.arguments.action })), messages: user("x"), ctx: CTX });
  const tools = r.added.filter((m) => m.role === "tool");
  assert.deepEqual(tools.map((m) => [m.tool_call_id, m.content]), [["a", '"one"'], ["b", '"two"']]);
});

test("a huge tool result is cut with a note to ask narrower", async () => {
  const { llm } = scripted(calls(["c1", "games", { action: "x" }]), text("ok"));
  const r = await runTurn({ llm, host: host(() => ({ status: "done", result: "y".repeat(50_000) })), messages: user("x"), ctx: CTX, maxToolChars: 2000 });
  assert.ok(r.added[1].content.length <= 2300);
  assert.match(r.added[1].content, /cut/i);
});

test("a model that keeps calling tools is stopped after maxSteps, and the turn still ends", async () => {
  const forever = Array.from({ length: 20 }, (_, i) => calls([`c${i}`, "games", { action: "x" }]));
  const { llm } = scripted(...forever);
  const seen = [];
  const r = await runTurn({ llm, host: host(() => ({ status: "done", result: 1 })), messages: user("x"), ctx: CTX, maxSteps: 3, onEvent: (e) => seen.push(e) });
  assert.equal(r.steps, 3);
  assert.equal(seen.find((e) => e.type === "error").code, "too_many_steps");
  assert.equal(seen.at(-1).type, "done");
});

test("a model failure ends the turn with an error event and never throws", async () => {
  const { llm } = scripted(new LlmError("the model answered 503", { status: 503, retryable: true }));
  const seen = [];
  const r = await runTurn({ llm, host: host(() => null), messages: user("x"), ctx: CTX, onEvent: (e) => seen.push(e) });
  assert.deepEqual(r.added, []);
  const err = seen.find((e) => e.type === "error");
  assert.deepEqual([err.code, err.retryable], ["model", true]);
  assert.equal(seen.at(-1).type, "done");
});

test("a failure after a tool ran keeps what already happened", async () => {
  const { llm } = scripted(calls(["c1", "games", { action: "x" }]), new LlmError("cut", { retryable: true }));
  const r = await runTurn({ llm, host: host(() => ({ status: "done", result: 1 })), messages: user("x"), ctx: CTX });
  assert.deepEqual(r.added.map((m) => m.role), ["assistant", "tool"]);
  assert.ok(r.error);
});

test("an abort stops before the next model call", async () => {
  const ctl = new AbortController();
  const { llm, sent } = scripted(calls(["c1", "games", { action: "x" }]), text("never"));
  const r = await runTurn({ llm, host: host(() => { ctl.abort(); return { status: "done", result: 1 }; }), messages: user("x"), ctx: CTX, signal: ctl.signal });
  assert.equal(sent.length, 1);
  assert.equal(r.aborted, true);
});

test("the history given in is not changed", async () => {
  const history = user("hi");
  const before = JSON.stringify(history);
  const { llm } = scripted(text("yo"));
  await runTurn({ llm, host: host(() => null), messages: history, ctx: CTX });
  assert.equal(JSON.stringify(history), before);
});
