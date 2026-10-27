import { test } from "node:test";
import assert from "node:assert/strict";

const { streamChat, LlmError } = await import("../../src/chat/llm.js");

const KEY = "k".repeat(40);
const enc = new TextEncoder();
const sse = (...objs) => objs.map((o) => `data: ${typeof o === "string" ? o : JSON.stringify(o)}\n\n`).join("");
const chunk = (delta, extra = {}) => ({ choices: [{ index: 0, delta, ...extra }] });

/** A fetch that answers with the given SSE text, cut into pieces of `size` bytes (to test partial lines). */
function fakeFetch(text, { status = 200, size = 7, seen = [], failAfter = null } = {}) {
  return async (url, init) => {
    seen.push({ url, init });
    if (status !== 200) return new Response(`{"error":{"message":"upstream said no ${KEY}"}}`, { status });
    const bytes = enc.encode(text);
    let at = 0;
    return new Response(new ReadableStream({
      pull(controller) {
        if (failAfter !== null && at >= failAfter) return controller.error(new Error("socket hang up"));
        if (at >= bytes.length) return controller.close();
        controller.enqueue(bytes.slice(at, at + size));
        at += size;
      },
    }), { status: 200, headers: { "content-type": "text/event-stream" } });
  };
}

const collect = async (gen) => {
  const out = [];
  for await (const e of gen) out.push(e);
  return out;
};
const conf = { baseUrl: "https://llm.example.com/api/v4/", apiKey: KEY, model: "glm-test" };
const run = (fetchImpl, extra = {}) => collect(streamChat({ ...conf, messages: [{ role: "user", content: "hi" }], fetchImpl, ...extra }));

test("text arrives in order, then usage and done", async () => {
  const text = sse(chunk({ role: "assistant", content: "Hel" }), chunk({ content: "lo" }), chunk({}, { finish_reason: "stop" }), { choices: [], usage: { prompt_tokens: 12, completion_tokens: 2, total_tokens: 14 } }, "[DONE]");
  const events = await run(fakeFetch(text));
  assert.deepEqual(events.filter((e) => e.type === "text").map((e) => e.delta), ["Hel", "lo"]);
  assert.deepEqual(events.find((e) => e.type === "usage").usage, { prompt_tokens: 12, completion_tokens: 2, total_tokens: 14 });
  assert.equal(events.at(-1).type, "done");
});

test("a tool call sent in fragments is one call with its full arguments", async () => {
  const text = sse(
    chunk({ tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "games", arguments: "" } }] }),
    chunk({ tool_calls: [{ index: 0, function: { arguments: '{"action":"games_' } }] }),
    chunk({ tool_calls: [{ index: 0, function: { arguments: 'search"}' } }] }, {}),
    chunk({}, { finish_reason: "tool_calls" }), "[DONE]");
  const events = await run(fakeFetch(text, { size: 5 }));
  const calls = events.find((e) => e.type === "tool_calls").calls;
  assert.deepEqual(calls, [{ id: "call_1", name: "games", arguments: '{"action":"games_search"}' }]);
});

test("several tool calls stay apart by index", async () => {
  const text = sse(
    chunk({ tool_calls: [{ index: 0, id: "a", function: { name: "x", arguments: "{}" } }, { index: 1, id: "b", function: { name: "y", arguments: "{" } }] }),
    chunk({ tool_calls: [{ index: 1, function: { arguments: "}" } }] }), "[DONE]");
  const calls = (await run(fakeFetch(text))).find((e) => e.type === "tool_calls").calls;
  assert.deepEqual(calls.map((c) => [c.id, c.name, c.arguments]), [["a", "x", "{}"], ["b", "y", "{}"]]);
});

test("a chunk that is not JSON is skipped and the rest still arrives", async () => {
  const text = sse(chunk({ content: "a" }), "not json at all", chunk({ content: "b" }), "[DONE]");
  const events = await run(fakeFetch(text));
  assert.deepEqual(events.filter((e) => e.type === "text").map((e) => e.delta), ["a", "b"]);
});

test("the request is the OpenAI chat format with the key in the header only", async () => {
  const seen = [];
  const tools = [{ name: "games", description: "d", inputSchema: { type: "object", properties: {} } }];
  await collect(streamChat({ ...conf, messages: [{ role: "user", content: "hi" }], tools, fetchImpl: fakeFetch(sse("[DONE]"), { seen }), maxTokens: 512 }));
  const { url, init } = seen[0];
  assert.equal(url, "https://llm.example.com/api/v4/chat/completions");
  assert.equal(init.headers.authorization, `Bearer ${KEY}`);
  const body = JSON.parse(init.body);
  assert.equal(body.model, "glm-test");
  assert.equal(body.stream, true);
  assert.deepEqual(body.stream_options, { include_usage: true });
  assert.equal(body.max_tokens, 512);
  assert.deepEqual(body.tools, [{ type: "function", function: { name: "games", description: "d", parameters: { type: "object", properties: {} } } }]);
  assert.ok(!init.body.includes(KEY), "the key is not in the body");
});

test("no tools means no tools field", async () => {
  const seen = [];
  await run(fakeFetch(sse("[DONE]"), { seen }));
  assert.equal("tools" in JSON.parse(seen[0].init.body), false);
});

test("an HTTP error becomes an LlmError with the status, and the key is never in it", async () => {
  for (const [status, retryable] of [[429, true], [500, true], [503, true], [400, false], [401, false]]) {
    await assert.rejects(run(fakeFetch("", { status })), (err) => {
      assert.ok(err instanceof LlmError);
      assert.equal(err.status, status);
      assert.equal(err.retryable, retryable, String(status));
      assert.ok(!err.message.includes(KEY));
      return true;
    });
  }
});

test("a stream that dies half way is an LlmError, not a silent end", async () => {
  const text = sse(chunk({ content: "partial" }), chunk({ content: " more" }));
  await assert.rejects(run(fakeFetch(text, { size: 10, failAfter: 30 })), (err) => err instanceof LlmError && err.retryable === true && !err.message.includes(KEY));
});

test("a stream that ends without [DONE] after a finish is still complete", async () => {
  const text = sse(chunk({ content: "ok" }), chunk({}, { finish_reason: "stop" }));
  const events = await run(fakeFetch(text));
  assert.equal(events.at(-1).type, "done");
});

test("an abort signal stops the request", async () => {
  const ctl = new AbortController();
  const seen = [];
  const p = run(fakeFetch(sse("[DONE]"), { seen }), { signal: ctl.signal });
  await p;
  assert.equal(seen[0].init.signal.constructor.name, "AbortSignal");
});
