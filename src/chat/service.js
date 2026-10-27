/**
 * The chat: one MCP host per account, the stored conversations, and one turn from a message to the
 * model's answer. The routes (routes/admin/chat-api.js for the admin, routes/chat.js for people
 * signed in on the web page) only carry these.
 *
 * Who is asking decides what the chat may do. A turn names `account` (whose conversations and
 * host these are), `owner` (who the MCP calls act as) and `admin`; the host of a person who is not
 * the admin runs under policy.USER_TIERS, so it is never offered an admin tool. A change such a
 * person asks for is parked as a request: the admin is told on Telegram, answers it from the
 * admin chat's waiting list, and the outcome is written into the person's conversation. Requests
 * live in memory and are gone after a restart, like the admin's own waiting calls.
 *
 * The model is the "chat" integration (security/integrations.js): what the admin saved on the
 * page, else COOK_CHAT_LLM_BASE_URL, COOK_CHAT_LLM_MODEL and COOK_CHAT_LLM_API_KEY. The key is read
 * here, handed to the request and never returned, logged or stored. The host talks to
 * the built-in MCP server in memory, so a call needs no token and no network hop.
 */
import path from "node:path";
import { createChatStore } from "./session-store.js";
import { runTurn } from "./agent-loop.js";
import { streamChat } from "./llm.js";
import * as integrations from "../security/integrations.js";
import { requestKind, tiersFor } from "./policy.js";
import { personaFromSettings, systemPrompt } from "./persona.js";
import { buildNotice } from "./notice.js";
import { alert } from "../helpers/alerts.js";
import * as env from "../helpers/envs.js";
import debug from "../debug.js";

export const MESSAGE_MAX = 4000;
const NOTE_MAX = 2000;
// Past this share of the context window, the next turn compacts the conversation before it asks the model.
export const COMPACT_AT = 0.8;
const SUMMARY_MAX = 6000;
const TOOL_LINE_MAX = 1500;
const CHARS_PER_TOKEN = 3;

const COMPACT_ASK = [
  "Summarise the conversation below so you can carry on from the summary alone: what the person wants, what was looked up and found",
  "(titles, ids, counts), what changed or is waiting for approval, and what is still open. Plain sentences, at most 300 words,",
  "in the language the person writes in. Do not call tools.",
].join(" ");

export class ChatError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "ChatError";
    this.code = code;
    this.status = status;
  }
}

/** The model settings in force; any of them empty means the chat is not set up. */
export const llmFromSettings = () => integrations.get("chat");

export const isConfigured = (cfg) => Boolean(cfg.baseUrl && cfg.model && cfg.apiKey);

/**
 * The stored rows the model is given: everything from the last summary on. A compaction appends a
 * summary row (compact: true) and leaves the rows before it in the file, so the person still sees
 * the whole conversation while the model sees the summary and what followed it.
 */
export function modelRows(rows) {
  const at = rows.findLastIndex((r) => r.compact === true);
  return at < 0 ? rows : rows.slice(at);
}

const estimateTokens = (messages) => Math.ceil(JSON.stringify(messages).length / CHARS_PER_TOKEN);
const clip = (text, max) => (text.length > max ? `${text.slice(0, max)}…` : text);

/** The rows as plain lines for the summary request; tool results are clipped and tool calls named. */
function transcript(rows, maxChars) {
  const lines = rows.map((r) => {
    if (r.role === "tool") return `tool result: ${clip(r.content, TOOL_LINE_MAX)}`;
    const called = r.tool_calls?.length ? ` [called ${r.tool_calls.map((c) => c.function?.name).join(", ")}]` : "";
    return `${r.role}: ${r.content}${called}`;
  });
  const text = lines.join("\n");
  return text.length > maxChars ? `…${text.slice(-maxChars)}` : text;
}

// What a stored message adds to the model's input; `at` is the store's, not the model's.
const modelView = ({ role, content, tool_calls, tool_call_id }) => ({ role, content, ...(tool_calls ? { tool_calls } : {}), ...(tool_call_id ? { tool_call_id } : {}) });

/** Tells the admin on Telegram that someone asked for a change; the words come from the tool, never the model. */
function notifyAdmin({ name, capId, area, id }) {
  alert("chat", (t, lang) => {
    const card = buildNotice({ actor: { name }, capId, area, outcome: "requested", change: true, requestId: id, lang });
    return `${card.body}\n${t("chatRequestHint")}`;
  }, { subject: id });
}

async function inMemoryHost({ owner, name, admin }) {
  // Loaded on the first chat, so a server that never uses it keeps the SDK out of memory.
  const [{ Client, InMemoryTransport }, { buildServer }, { createMcpHost }] = await Promise.all([
    import("@modelcontextprotocol/client"),
    import("../mcp/server.js"),
    import("./mcp-host.js"),
  ]);
  const server = buildServer({ token: { id: null, label: "chat", owner }, by: { type: "chat", name } });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "cookingfoil-chat", version: "1" });
  await client.connect(clientSide);
  return createMcpHost({ client, base: tiersFor(admin) });
}

export function createChatService({
  dir, llmConfig = llmFromSettings, persona = personaFromSettings, contextWindow = () => env.chatContextTokens,
  stream = streamChat, makeHost = inMemoryHost, notify = notifyAdmin,
} = {}) {
  const store = createChatStore({ dir });
  const hosts = new Map(); // account -> Promise of its host

  const hostOf = ({ account, owner, admin, name }) => {
    if (!hosts.has(account)) {
      const made = makeHost({ owner, name, admin: admin === true });
      hosts.set(account, made);
      made.catch(() => hosts.delete(account));
    }
    return hosts.get(account);
  };

  /** The host holding waiting call `id`: only the caller's own unless the caller is the admin. */
  async function holderOf(id, { account, admin }) {
    const own = hosts.get(account);
    if (own && (await own.catch(() => null))?.owner?.(id)) return own;
    if (admin !== true) return null;
    for (const [acct, made] of hosts) {
      if (acct === account) continue;
      const host = await made.catch(() => null);
      if (host?.owner?.(id)) return made;
    }
    return null;
  }

  const note = (account, conversation, entry) => {
    if (!conversation) return;
    try {
      store.append(account, conversation, entry);
    } catch {
      // The conversation was removed meanwhile; the call still ran or was dropped.
    }
  };

  const load = (account, id) => {
    const rows = store.load(account, id);
    if (!rows) throw new ChatError("no_conversation", "no such conversation", 404);
    return rows;
  };

  /** How full the model's context is for this conversation: { used, window } in tokens. */
  const contextOf = (account, id) => ({ used: Number(store.meta(account, id)?.context) || 0, window: contextWindow() });

  /** Asks the model to sum up what it sees of the conversation and puts the summary in its place. */
  async function compactNow({ account, admin, id, cfg, signal }) {
    const rows = modelRows(load(account, id));
    if (!rows.some((r) => r.role === "user" || r.role === "assistant")) return contextOf(account, id);
    const ask = [
      { role: "system", content: systemPrompt(persona(), { admin }) },
      { role: "user", content: `${COMPACT_ASK}\n\n${transcript(rows, Math.floor(contextWindow() * CHARS_PER_TOKEN * 0.6))}` },
    ];
    let text = "";
    try {
      for await (const e of stream({ ...cfg, messages: ask, signal })) if (e.type === "text") text += e.delta;
    } catch (err) {
      throw new ChatError("compact_failed", `the model could not summarise: ${String(err.message).split(cfg.apiKey).join("***")}`, 502);
    }
    if (!text.trim()) throw new ChatError("compact_failed", "the model gave no summary", 502);
    const summary = { role: "system", compact: true, content: `Summary of the conversation before this point; the older messages are no longer shown to you:\n${clip(text.trim(), SUMMARY_MAX)}` };
    store.append(account, id, summary);
    store.mark(account, id, { context: estimateTokens([ask[0], modelView(summary)]) });
    return contextOf(account, id);
  }

  return {
    configured: () => isConfigured(llmConfig()),

    list: (account) => store.list(account),

    load,

    context: (account, id) => {
      load(account, id);
      return contextOf(account, id);
    },

    /** Compacts conversation `id` of `account` now (the meter's button); 404 for anyone else's. */
    async compact({ account, admin, conversation, signal }) {
      const cfg = llmConfig();
      if (!isConfigured(cfg)) throw new ChatError("not_configured", "the model is not set up on this server", 409);
      load(account, conversation);
      return compactNow({ account, admin, id: conversation, cfg, signal });
    },

    remove: (account, id) => store.remove(account, id),

    /** The calls this account is waiting on (they live in memory and are gone after a restart). */
    async pending(account) {
      const made = hosts.get(account);
      return made ? (await made).pending(account).map((p) => (requestKind(p.capId) ? { ...p, kind: requestKind(p.capId) } : p)) : [];
    },

    /** Requests from other accounts that an admin can answer. */
    async requests(account) {
      const out = [];
      for (const [acct, made] of hosts) {
        if (acct === account) continue;
        const host = await made.catch(() => null);
        if (host?.awaiting) out.push(...host.awaiting());
      }
      return out.map(({ account: _account, ...r }) => r).sort((a, b) => a.createdAt - b.createdAt);
    },

    /**
     * One turn. Events go to onEvent as they happen; the user's message and what the turn added are
     * stored whatever the outcome, so a reload shows what the admin saw.
     */
    async turn({ account, owner = account, admin, name, conversation, message, onEvent, signal }) {
      const cfg = llmConfig();
      if (!isConfigured(cfg)) throw new ChatError("not_configured", "the model is not set up on this server", 409);
      if (typeof message !== "string" || !message.trim()) throw new ChatError("bad_message", "the message is empty");
      if (message.length > MESSAGE_MAX) throw new ChatError("too_long", `a message is at most ${MESSAGE_MAX} characters; this one has ${message.length}`, 413);
      let id = conversation;
      let history = [];
      if (id) history = load(account, id);
      else id = store.create(account);
      const { used, window } = contextOf(account, id);
      if (history.length && used >= window * COMPACT_AT) {
        onEvent({ type: "compacting", conversation: id });
        try {
          await compactNow({ account, admin, id, cfg, signal });
          history = load(account, id);
          onEvent({ type: "context", ...contextOf(account, id), compacted: true, conversation: id });
        } catch (err) {
          // The turn still runs on the full history; the model's own limit is the next thing to say no.
          onEvent({ type: "error", code: "compact_failed", message: err.message, retryable: false, conversation: id });
        }
      }
      const user = { role: "user", content: message };
      store.append(account, id, user);
      const host = await hostOf({ account, owner, admin, name });
      const messages = [{ role: "system", content: systemPrompt(persona(), { admin }) }, ...modelRows(history).map(modelView), user];
      const out = await runTurn({
        llm: (o) => stream({ ...cfg, ...o }),
        host, messages, ctx: { account, admin: admin === true, conversation: id, name },
        onEvent: (e) => {
          if (e.type === "approval" && e.status === "requested") {
            try {
              notify({ name, capId: e.action ?? e.tool, area: e.tool, id: e.id });
            } catch (err) {
              debug.error("chat: could not tell the admin: %s", err.message);
            }
          }
          const kind = e.type === "approval" && e.status === "requested" ? { kind: requestKind(e.action ?? e.tool) } : {};
          onEvent({ ...e, ...kind, ...(typeof e.message === "string" ? { message: e.message.split(cfg.apiKey).join("***") } : {}), conversation: id });
        },
        signal,
      });
      for (const m of out.added) {
        try {
          store.append(account, id, m);
        } catch (err) {
          debug.error("chat: could not store a message: %s", err.message);
        }
      }
      if (out.usage.context_tokens > 0) {
        store.mark(account, id, { context: out.usage.context_tokens });
        onEvent({ type: "context", ...contextOf(account, id), conversation: id });
      }
      return { conversation: id, usage: out.usage, error: Boolean(out.error) };
    },

    /**
     * Settles a waiting call: approve runs it as stored, otherwise it is dropped. Only an admin
     * settles anything, and only an admin reaches another account's request; the outcome goes into
     * the conversation the call came from (a person's request) or the one given (the admin's own).
     */
    async decide({ account, admin, id, approve, conversation }) {
      const made = await holderOf(id, { account, admin });
      if (!made) return { status: "denied", message: "no such request" };
      const host = await made;
      const from = host.owner(id);
      const ctx = { account, admin: admin === true };
      const where = from.account === account ? [account, conversation] : [from.account, from.conversation];
      if (!approve) {
        const refused = host.refuse(id, ctx);
        if (refused && from.account !== account) note(...where, { role: "system", note: "refused", content: "The admin refused the waiting call; it did not run." });
        return { status: refused ? "refused" : "denied" };
      }
      const result = await host.approve(id, ctx);
      if (result.status === "done") note(...where, { role: "system", note: "approved", content: `The admin approved the waiting call. It ran: ${JSON.stringify(result.result).slice(0, NOTE_MAX)}` });
      else if (result.status === "error" && from.account !== account) note(...where, { role: "system", note: "failed", content: `The admin approved the waiting call, but it failed: ${JSON.stringify(result.error).slice(0, NOTE_MAX)}` });
      return result;
    },
  };
}

let shared = null;
/** The one service of this server, its conversations under `<dataDir>/chat`. */
export function chatService(dataDir) {
  return (shared ??= createChatService({ dir: path.join(dataDir, "chat") }));
}
