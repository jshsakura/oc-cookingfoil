/**
 * One chat turn: ask the model, run the tools it calls through the host, give it the results, and
 * repeat until it answers in words. The host decides what a call may do (policy.js); this loop only
 * carries messages and never throws: a failure ends the turn with an `error` event and a `done`,
 * so a screen waiting on the turn is always released.
 *
 *   runTurn({ llm, host, messages, ctx, onEvent, maxSteps, maxToolChars, signal })
 *     -> { added, steps, usage: { prompt_tokens, completion_tokens, context_tokens }, error?, aborted? }
 *
 * A tool result may carry `cards` (chat/cards.js). They go to the screen as a `cards` event and are
 * kept on the stored tool message, so a reload shows them again; the model is given the ids and
 * names instead, and told the person already sees the cards.
 *
 * `added` is what this turn appended to the conversation (assistant and tool messages); the
 * `messages` given in are not changed. A call that waits for an approval is told to the screen as an
 * `approval` event and to the model as "waiting", so the model says so and does not call it again.
 */
import debug from "../debug.js";
import { cleanCards } from "./cards.js";

export const MAX_STEPS = 8;
export const MAX_TOOL_CHARS = 12_000;

const WAITING = JSON.stringify({ status: "waiting_for_approval", note: "A person must approve this before it runs. Tell them it is waiting; do not call it again." });

// A long run that reads as base64 (mixed case with digits or +/) or as hex is file content, not
// something to read; it is dropped before the result enters the conversation, so a tool that hands
// back a file cannot fill the context with it.
const RUN_RE = /[A-Za-z0-9+/=_-]{512,}/g;
const isBlob = (run) => (/[A-Z]/.test(run) && /[a-z]/.test(run) && /[0-9+/]/.test(run)) || (/^[0-9a-fA-F]+$/.test(run) && /[0-9]/.test(run) && /[a-fA-F]/.test(run));
export const scrubBlobs = (text) => text.replace(RUN_RE, (m) => (isBlob(m) ? `[${m.length} characters of file data left out]` : m));

/** A tool result's cards as the page may draw them, and the result the model is given in their place. */
function splitCards(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.cards)) return { cards: [], rest: value };
  const cards = cleanCards(value.cards);
  const { cards: _drawn, ...rest } = value;
  if (!cards.length) return { cards, rest };
  return { cards, rest: { ...rest, shown: cards.map(({ id, name, platform }) => ({ id, name, platform })), note: "The person already sees these as cards; do not list their details again." } };
}

const cutTo = (text, max) => (text.length > max ? `${text.slice(0, max)}…[cut ${text.length - max} characters; ask for less, with a filter or a limit]` : text);

export async function runTurn({ llm, host, messages, ctx, onEvent = () => {}, maxSteps = MAX_STEPS, maxToolChars = MAX_TOOL_CHARS, signal, llmOptions = {} }) {
  const history = [...messages];
  const added = [];
  // context_tokens is the last request's prompt size: how full the model's context is now.
  const out = { added, steps: 0, usage: { prompt_tokens: 0, completion_tokens: 0, context_tokens: 0 } };
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
      return { content: JSON.stringify({ error: "arguments were not valid JSON; send one JSON object" }) };
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
      return { content: WAITING };
    }
    if (result?.status === "denied") return { content: JSON.stringify({ error: result.message }) };
    if (result?.status === "error") return { content: JSON.stringify({ error: result.error }) };
    const { cards, rest } = splitCards(result?.result ?? null);
    if (cards.length) onEvent({ type: "cards", id: call.id, cards });
    return { content: cutTo(scrubBlobs(JSON.stringify(rest ?? null)), maxToolChars), ...(cards.length ? { cards } : {}) };
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
            out.usage.context_tokens = (e.usage.prompt_tokens ?? 0) + (e.usage.completion_tokens ?? 0);
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
      calls.forEach((c, i) => push({ role: "tool", tool_call_id: c.id, content: results[i].content, ...(results[i].cards ? { cards: results[i].cards } : {}) }));
    }
  } catch (err) {
    out.error = err;
    debug.error("chat: turn failed: %s", err?.stack ?? err);
    onEvent({ type: "error", code: "internal", message: "the chat failed", retryable: false });
  }
  onEvent({ type: "done" });
  return out;
}
