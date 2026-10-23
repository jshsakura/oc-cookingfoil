/**
 * What a tool call returns: its value as compact JSON text, or an error the model can act on,
 * { error: { code, message, hint?, next? } } with isError. A handler's error with a 4xx `status`
 * keeps its message; anything else is INTERNAL with a time to find in the server log, so paths and
 * stack details stay on the server.
 */
import debug from "../debug.js";

// Under Claude Code's default 25,000-token result cap in UTF-8 bytes (ServiceNow MCP's measure).
export const BUDGET_BYTES = 60_000;

const STATUS_CODES = { 400: "BAD_INPUT", 404: "NOT_FOUND", 409: "CONFLICT" };

export class ToolError extends Error {
  constructor(code, message, { hint, next } = {}) {
    super(message);
    this.code = code;
    this.hint = hint;
    this.next = next;
  }
}

const bytes = (s) => Buffer.byteLength(s, "utf8");

/** The longest array in `value` or one level down, as [holder, key], or null. */
function longestList(value) {
  let best = null;
  let bestSize = 0;
  const consider = (holder, key) => {
    if (!Array.isArray(holder[key]) || holder[key].length < 2) return;
    const size = bytes(JSON.stringify(holder[key]));
    if (size > bestSize) [best, bestSize] = [[holder, key], size];
  };
  for (const key of Object.keys(value)) {
    consider(value, key);
    if (value[key] && typeof value[key] === "object" && !Array.isArray(value[key])) for (const k of Object.keys(value[key])) consider(value[key], k);
  }
  return best;
}

/**
 * `value` as compact JSON within BUDGET_BYTES: rows are dropped from the end of its longest list,
 * and `truncated: { list, kept, dropped }` says so. A value with no list to shorten is sent whole.
 */
export function fitJson(value, budget = BUDGET_BYTES) {
  const whole = JSON.stringify(value);
  if (bytes(whole) <= budget || !value || typeof value !== "object" || Array.isArray(value)) return whole;
  const copy = structuredClone(value);
  const found = longestList(copy);
  if (!found) return whole;
  const [holder, key] = found;
  const all = holder[key];
  let lo = 0;
  let hi = all.length;
  let text = whole;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    holder[key] = all.slice(0, mid);
    const candidate = JSON.stringify({ ...copy, truncated: { list: key, kept: mid, dropped: all.length - mid } });
    if (bytes(candidate) <= budget) [lo, text] = [mid, candidate];
    else hi = mid - 1;
  }
  if (lo === 0) {
    holder[key] = [];
    text = JSON.stringify({ ...copy, truncated: { list: key, kept: 0, dropped: all.length } });
  }
  return text;
}

export const okResult = (value) => ({ content: [{ type: "text", text: fitJson(value ?? null) }] });

export function errorResult(err, tool) {
  let error;
  if (err instanceof ToolError) error = { code: err.code, message: err.message, ...(err.hint ? { hint: err.hint } : {}), ...(err.next ? { next: err.next } : {}) };
  else if (err?.status >= 400 && err.status < 500) error = { code: STATUS_CODES[err.status] ?? "BAD_INPUT", message: err.message };
  else {
    const at = new Date().toISOString();
    debug.error("mcp: %s failed at %s: %s", tool, at, err?.stack ?? err);
    error = { code: "INTERNAL", message: `The server failed at ${at}; its log has the details.` };
  }
  return { content: [{ type: "text", text: JSON.stringify({ error }) }], isError: true };
}
