/**
 * The chat for the admin page: one MCP host per account, the stored conversations, and one turn
 * from a message to the model's answer. The route (routes/admin/chat-api.js) only carries these.
 *
 * The model comes from COOK_CHAT_LLM_BASE_URL, COOK_CHAT_LLM_MODEL and COOK_CHAT_LLM_API_KEY. The
 * key is read here, handed to the request and never returned, logged or stored. The host talks to
 * the built-in MCP server in memory, so a call needs no token and no network hop.
 */
import path from "node:path";
import { createChatStore } from "./session-store.js";
import { runTurn } from "./agent-loop.js";
import { streamChat } from "./llm.js";
import debug from "../debug.js";

export const MESSAGE_MAX = 8000;
const NOTE_MAX = 2000;

export class ChatError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "ChatError";
    this.code = code;
    this.status = status;
  }
}

const SYSTEM_PROMPT = [
  "You help the admin of a CookingFoil game server through its tools.",
  "Look things up with the tools before you answer; do not guess what the library holds.",
  "A change waits for the admin's approval. When a tool says a call is waiting for approval, tell the admin it is waiting and stop; do not call it again.",
  "Answer in the language the admin writes in, briefly.",
].join(" ");

/** The model settings from the environment; any of them empty means the chat is not set up. */
export const llmFromEnv = (env = process.env) => ({
  baseUrl: (env.COOK_CHAT_LLM_BASE_URL ?? "").trim(),
  model: (env.COOK_CHAT_LLM_MODEL ?? "").trim(),
  apiKey: (env.COOK_CHAT_LLM_API_KEY ?? "").trim(),
});

export const isConfigured = (cfg) => Boolean(cfg.baseUrl && cfg.model && cfg.apiKey);

// What a stored message adds to the model's input; `at` is the store's, not the model's.
const modelView = ({ role, content, tool_calls, tool_call_id }) => ({ role, content, ...(tool_calls ? { tool_calls } : {}), ...(tool_call_id ? { tool_call_id } : {}) });

async function inMemoryHost(account, name) {
  // Loaded on the first chat, so a server that never uses it keeps the SDK out of memory.
  const [{ Client, InMemoryTransport }, { buildServer }, { createMcpHost }] = await Promise.all([
    import("@modelcontextprotocol/client"),
    import("../mcp/server.js"),
    import("./mcp-host.js"),
  ]);
  const server = buildServer({ token: { id: null, label: "chat", owner: account }, by: { type: "chat", name } });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "cookingfoil-chat", version: "1" });
  await client.connect(clientSide);
  return createMcpHost({ client });
}

export function createChatService({ dir, llmConfig = llmFromEnv, stream = streamChat, makeHost = inMemoryHost } = {}) {
  const store = createChatStore({ dir });
  const hosts = new Map(); // account -> Promise of its host

  const hostOf = (account, name) => {
    if (!hosts.has(account)) {
      const made = makeHost(account, name);
      hosts.set(account, made);
      made.catch(() => hosts.delete(account));
    }
    return hosts.get(account);
  };

  const load = (account, id) => {
    const rows = store.load(account, id);
    if (!rows) throw new ChatError("no_conversation", "no such conversation", 404);
    return rows;
  };

  return {
    configured: () => isConfigured(llmConfig()),

    list: (account) => store.list(account),

    load,

    remove: (account, id) => store.remove(account, id),

    /** The calls this account is waiting on (they live in memory and are gone after a restart). */
    async pending(account) {
      const made = hosts.get(account);
      return made ? (await made).pending(account) : [];
    },

    /**
     * One turn. Events go to onEvent as they happen; the user's message and what the turn added are
     * stored whatever the outcome, so a reload shows what the admin saw.
     */
    async turn({ account, admin, name, conversation, message, onEvent, signal }) {
      const cfg = llmConfig();
      if (!isConfigured(cfg)) throw new ChatError("not_configured", "the model is not set up on this server", 409);
      if (typeof message !== "string" || !message.trim() || message.length > MESSAGE_MAX) throw new ChatError("bad_message", `a message is 1 to ${MESSAGE_MAX} characters`);
      let id = conversation;
      let history = [];
      if (id) history = load(account, id);
      else id = store.create(account);
      const user = { role: "user", content: message };
      store.append(account, id, user);
      const host = await hostOf(account, name);
      const messages = [{ role: "system", content: SYSTEM_PROMPT }, ...history.map(modelView), user];
      const out = await runTurn({
        llm: (o) => stream({ ...cfg, ...o }),
        host, messages, ctx: { account, admin },
        onEvent: (e) => onEvent({ ...e, ...(typeof e.message === "string" ? { message: e.message.split(cfg.apiKey).join("***") } : {}), conversation: id }),
        signal,
      });
      for (const m of out.added) {
        try {
          store.append(account, id, m);
        } catch (err) {
          debug.error("chat: could not store a message: %s", err.message);
        }
      }
      return { conversation: id, usage: out.usage, error: Boolean(out.error) };
    },

    /** Settles a waiting call: approve runs it as stored, otherwise it is dropped. */
    async decide({ account, admin, id, approve, conversation }) {
      const made = hosts.get(account);
      if (!made) return { status: "denied", message: "no such request" };
      const host = await made;
      if (!approve) return { status: host.refuse(id, { account, admin }) ? "refused" : "denied" };
      const result = await host.approve(id, { account, admin });
      if (conversation && result.status === "done") {
        try {
          store.append(account, conversation, { role: "system", content: `The admin approved the waiting call. It ran: ${JSON.stringify(result.result).slice(0, NOTE_MAX)}` });
        } catch {
          // The conversation was removed meanwhile; the call still ran.
        }
      }
      return result;
    },
  };
}

let shared = null;
/** The one service of this server, its conversations under `<dataDir>/chat`. */
export function chatService(dataDir) {
  return (shared ??= createChatService({ dir: path.join(dataDir, "chat") }));
}
