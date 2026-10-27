/**
 * One chat turn: ask the model, run the tools it calls through the host, give it the results, and
 * repeat until it answers in words. The host decides what a call may do (policy.js); this loop only
 * carries messages and never throws: a failure ends the turn with an `error` event and a `done`,
 * so a screen waiting on the turn is always released.
 *
 *   runTurn({ llm, host, messages, ctx, onEvent, maxSteps, maxToolChars, signal })
 *     -> { added, steps, usage, error?, aborted? }
 *
 * `added` is what this turn appended to the conversation (assistant and tool messages); the
 * `messages` given in are not changed. A call that waits for an approval is told to the screen as an
 * `approval` event and to the model as "waiting", so the model says so and does not call it again.
 */
import debug from "../debug.js";

export const MAX_STEPS = 8;
export const MAX_TOOL_CHARS = 12_000;

const WAITING = JSON.stringify({ status: "waiting_for_approval", note: "A person must approve this before it runs. Tell them it is waiting; do not call it again." });

const cutTo = (text, max) => (text.length > max ? `${text.slice(0, max)}…[cut ${text.length - max} characters; ask for less, with a filter or a limit]` : text);

export async function runTurn({ llm, host, messages, ctx, onEvent = () => {}, maxSteps = MAX_STEPS, maxToolChars = MAX_TOOL_CHARS, signal, llmOptions = {} }) {
  const history = [...messages];
  const added = [];
  const out = { added, steps: 0, usage: { prompt_tokens: 0, completion_tokens: 0 } };
  const push = (m) => {
    history.push(m);
    added.push(m);
  };

  async function runCall(call) {
    let args;
    try {
      args = JSON.parse(call.arguments || "{}");
      if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("not an object");
    } catch {
      return JSON.stringify({ error: "arguments were not valid JSON; send one JSON object" });
    }
    onEvent({ type: "tool_start", id: call.id, name: call.name, action: args.action ?? null });
    let result;
    try {
      result = await host.call(ctx, { tool: call.name, arguments: args });
    } catch (err) {
      debug.error("chat: tool %s failed: %s", call.name, err?.stack ?? err);
      result = { status: "error", error: { code: "INTERNAL", message: "the tool failed" } };
    }
    onEvent({ type: "tool_end", id: call.id, status: result?.status ?? "done" });
    if (result?.status === "pending" || result?.status === "requested") {
      onEvent({ type: "approval", id: result.id, status: result.status, preview: result.preview, tool: call.name, action: args.action ?? null });
      return WAITING;
    }
    if (result?.status === "denied") return JSON.stringify({ error: result.message });
    if (result?.status === "error") return JSON.stringify({ error: result.error });
    return cutTo(JSON.stringify(result?.result ?? null), maxToolChars);
  }

  try {
    const tools = await host.tools();
    while (true) {
      if (signal?.aborted) {
        out.aborted = true;
        break;
      }
      if (out.steps >= maxSteps) {
        onEvent({ type: "error", code: "too_many_steps", message: "the model kept calling tools; stopped", retryable: false });
        break;
      }
      out.steps++;

      let text = "";
      let calls = [];
      try {
        for await (const e of llm({ messages: history, tools, signal, ...llmOptions })) {
          if (e.type === "text") {
            text += e.delta;
            onEvent(e);
          } else if (e.type === "tool_calls") calls = e.calls;
          else if (e.type === "usage") {
            out.usage.prompt_tokens += e.usage.prompt_tokens ?? 0;
            out.usage.completion_tokens += e.usage.completion_tokens ?? 0;
          }
        }
      } catch (err) {
        out.error = err;
        onEvent({ type: "error", code: "model", message: err.message, retryable: err.retryable === true });
        break;
      }

      push(calls.length
        ? { role: "assistant", content: text, tool_calls: calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.arguments } })) }
        : { role: "assistant", content: text });
      if (!calls.length) break;

      const results = await Promise.all(calls.map(runCall));
      calls.forEach((c, i) => push({ role: "tool", tool_call_id: c.id, content: results[i] }));
    }
  } catch (err) {
    out.error = err;
    debug.error("chat: turn failed: %s", err?.stack ?? err);
    onEvent({ type: "error", code: "internal", message: "the chat failed", retryable: false });
  }
  onEvent({ type: "done" });
  return out;
}
