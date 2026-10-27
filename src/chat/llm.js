/**
 * A streaming chat call to an OpenAI-compatible endpoint (GLM among them), with `fetch` and no SDK.
 *
 *   for await (const event of streamChat({ baseUrl, apiKey, model, messages, tools })) ...
 *
 * Events: { type: "text", delta }, { type: "usage", usage }, { type: "tool_calls", calls: [{ id,
 * name, arguments }] } (arguments is the JSON text, whole), then { type: "done" }. A failure is an
 * LlmError with the HTTP status (when there is one) and whether trying again could help; the key is
 * taken out of every message. A stream that stops before the provider finished is an error, never a
 * quiet end, so the caller can say so instead of showing a half answer as complete.
 */

export class LlmError extends Error {
  constructor(message, { status = null, retryable = false } = {}) {
    super(message);
    this.name = "LlmError";
    this.status = status;
    this.retryable = retryable;
  }
}

const ERROR_TEXT_MAX = 300;
const DEFAULT_TIMEOUT_MS = 120_000;

const openAiTool = (t) => ({ type: "function", function: { name: t.name, description: t.description ?? "", parameters: t.inputSchema ?? { type: "object", properties: {} } } });

export async function* streamChat({ baseUrl, apiKey, model, messages, tools = [], maxTokens, temperature, signal, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = fetch }) {
  const hide = (s) => (apiKey ? String(s).split(apiKey).join("***") : String(s));
  const body = { model, messages, stream: true, stream_options: { include_usage: true } };
  if (maxTokens) body.max_tokens = maxTokens;
  if (temperature !== undefined) body.temperature = temperature;
  if (tools.length) body.tools = tools.map(openAiTool);

  const timeout = AbortSignal.timeout(timeoutMs);
  let res;
  try {
    res = await fetchImpl(`${String(baseUrl).replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (err) {
    throw new LlmError(`could not reach the model: ${hide(err.message)}`, { retryable: !signal?.aborted });
  }

  if (!res.ok) {
    const text = hide(await res.text().catch(() => "")).slice(0, ERROR_TEXT_MAX);
    throw new LlmError(`the model answered ${res.status}: ${text}`, { status: res.status, retryable: res.status === 408 || res.status === 429 || res.status >= 500 });
  }

  const calls = [];
  let usage = null;
  let finished = false;
  const handle = (line) => {
    if (!line.startsWith("data:")) return [];
    const data = line.slice(5).trim();
    if (data === "[DONE]") {
      finished = true;
      return [];
    }
    let obj;
    try {
      obj = JSON.parse(data);
    } catch {
      return [];
    }
    const out = [];
    if (obj.usage) usage = obj.usage;
    for (const choice of obj.choices ?? []) {
      const delta = choice.delta ?? {};
      if (typeof delta.content === "string" && delta.content) out.push({ type: "text", delta: delta.content });
      for (const part of delta.tool_calls ?? []) {
        const call = (calls[part.index ?? 0] ??= { id: "", name: "", arguments: "" });
        if (part.id) call.id = part.id;
        if (part.function?.name) call.name = part.function.name;
        if (part.function?.arguments) call.arguments += part.function.arguments;
      }
      if (choice.finish_reason) finished = true;
    }
    return out;
  };

  const decoder = new TextDecoder();
  let pending = "";
  try {
    for await (const piece of res.body) {
      pending += decoder.decode(piece, { stream: true });
      const lines = pending.split("\n");
      pending = lines.pop();
      for (const line of lines) yield* handle(line.trim());
    }
    pending += decoder.decode();
    if (pending.trim()) yield* handle(pending.trim());
  } catch (err) {
    throw new LlmError(`the model stream was cut: ${hide(err.message)}`, { retryable: !signal?.aborted });
  }
  if (!finished) throw new LlmError("the model stream ended before it finished", { retryable: true });

  if (usage) yield { type: "usage", usage };
  const made = calls.filter(Boolean);
  if (made.length) yield { type: "tool_calls", calls: made };
  yield { type: "done" };
}
