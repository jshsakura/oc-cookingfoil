/**
 * The chat's side of MCP: sits between the model and one MCP server and decides, by the policy
 * table and never by the model, what a call may do.
 *
 *   tools()               the server's tools as the model sees them: blocked and unlisted actions
 *                         and the `confirm` argument are cut out of the schema
 *   call(ctx, request)    run an auto action; for an approve-tier one, ask the server for its
 *                         preview and park the call as pending (the admin's own) or requested
 *                         (a person asks, an admin answers); anything blocked is refused
 *   approve / refuse      settle a parked call; it runs exactly as stored, once
 *
 * The model's own `confirm` is never forwarded. Only this host sends `confirm: "approve"`, for an
 * auto action at once and for a parked one after its approval. An approve-tier action whose server
 * shows no preview is refused: nothing runs that nobody has seen.
 *
 * One host serves one account (the server behind it was built for that account's ctx). Parked
 * calls live in memory and lapse after ttlMs. A person who is not the admin has at most
 * MAX_OPEN_REQUESTS waiting at once, so one message cannot fill the admin's list.
 */
import crypto from "node:crypto";
import { DEFAULT_TIERS, decide, tierOf } from "./policy.js";

export const PENDING_TTL_MS = 30 * 60 * 1000;
export const MAX_OPEN_REQUESTS = 3;
// The model relays this to the person in their language, so it is given in each.
const TOO_MANY_WORDS = {
  ko: "이미 관리자 승인을 기다리는 요청이 있습니다. 처리된 뒤에 다시 요청해 주세요.",
  en: "There are already requests waiting for the admin's approval. Please ask again once they are handled.",
  ja: "管理者の承認を待っているリクエストがすでにあります。処理されたあとで、もう一度お願いします。",
  zh: "已有请求在等待管理员批准。请在处理完成后再提出请求。",
};
const TOO_MANY_REQUESTS = `${MAX_OPEN_REQUESTS} requests are already waiting for the admin. Tell the person, in their language: ${Object.values(TOO_MANY_WORDS).join(" / ")}`;
const STANDALONE = new Set(["help"]);

const clone = (value) => structuredClone(value);
const denied = (message) => ({ status: "denied", message });

/** The value a tool result carries: its JSON text parsed, or the text itself. */
function valueOf(result) {
  const raw = (result?.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return raw;
  }
}

function outcome(result) {
  const value = valueOf(result);
  if (result?.isError) return { status: "error", error: value?.error ?? { code: "ERROR", message: String(value ?? "tool failed") } };
  return { status: "done", result: value };
}

/** `base` is the table this host runs under (policy.tiersFor); `tiers` overrides single entries. */
export function createMcpHost({ client, base = DEFAULT_TIERS, tiers = {}, now = Date.now, ttlMs = PENDING_TTL_MS }) {
  const table = { ...base, ...tiers };
  const parked = new Map();
  let confirmable = null; // tool names whose schema takes confirm

  const purge = () => {
    for (const [id, rec] of parked) if (now() - rec.createdAt > ttlMs) parked.delete(id);
  };

  async function listed() {
    const { tools } = await client.listTools();
    confirmable = new Set(tools.filter((t) => t.inputSchema?.properties?.confirm).map((t) => t.name));
    return tools;
  }

  const capabilityOf = (tool, args) => (STANDALONE.has(tool) ? tool : args?.action);

  async function execute(tool, args, withConfirm) {
    const { confirm: _dropped, ...rest } = args ?? {};
    return client.callTool({ name: tool, arguments: withConfirm ? { ...rest, confirm: "approve" } : rest });
  }

  return {
    /** The tools the model may use, with blocked actions and `confirm` removed. */
    async tools() {
      const out = [];
      for (const tool of await listed()) {
        const schema = clone(tool.inputSchema ?? { type: "object", properties: {} });
        if (STANDALONE.has(tool.name)) {
          if (tierOf(tool.name, table) !== "blocked") out.push({ ...clone(tool), inputSchema: schema });
          continue;
        }
        const actions = schema.properties?.action?.enum;
        if (!Array.isArray(actions)) continue;
        const offered = actions.filter((a) => tierOf(a, table) !== "blocked");
        if (!offered.length) continue;
        schema.properties.action.enum = offered;
        delete schema.properties.confirm;
        if (Array.isArray(schema.required)) schema.required = schema.required.filter((k) => k !== "confirm");
        out.push({ ...clone(tool), inputSchema: schema });
      }
      return out;
    },

    /** One call from the model, for `ctx` = { account, admin, conversation? }. */
    async call(ctx, { tool, arguments: args }) {
      purge();
      const capId = capabilityOf(tool, args);
      const tier = tierOf(capId, table);
      const decision = decide(tier, { admin: ctx.admin === true });
      if (decision === "deny") return denied(`${capId ?? tool} is not available in chat`);
      if (decision === "request" && [...parked.values()].filter((r) => r.account === ctx.account).length >= MAX_OPEN_REQUESTS) return denied(TOO_MANY_REQUESTS);
      if (confirmable === null) await listed();

      if (decision === "run") return outcome(await execute(tool, args, confirmable.has(tool) && !STANDALONE.has(tool)));

      const first = await execute(tool, args, false);
      if (first.isError) return outcome(first);
      const value = valueOf(first);
      if (!value || typeof value !== "object" || !("preview" in value)) return denied(`${capId} gave no preview, so it cannot be approved`);
      const id = crypto.randomBytes(16).toString("base64url");
      const status = decision === "preview" ? "pending" : "requested";
      parked.set(id, { id, account: ctx.account, conversation: ctx.conversation ?? null, by: ctx.name ?? null, tool, capId, arguments: clone(args), preview: clone(value.preview), status, createdAt: now() });
      return { status, id, preview: clone(value.preview) };
    },

    /** Who parked call `id` came from, or null when this host holds no such call. */
    owner(id) {
      purge();
      const rec = parked.get(id);
      return rec ? { account: rec.account, conversation: rec.conversation, capId: rec.capId, tool: rec.tool, status: rec.status } : null;
    },

    /** Runs a parked call as stored. A pending call is settled by its own admin, a requested one by any admin. */
    async approve(id, ctx) {
      purge();
      const rec = parked.get(id);
      if (!rec || !mayDecide(rec, ctx)) return denied("no such request");
      parked.delete(id);
      if (tierOf(rec.capId, table) === "blocked") return denied(`${rec.capId} is no longer available in chat`);
      return outcome(await execute(rec.tool, rec.arguments, true));
    },

    /** Drops a parked call; false when there is none this account may settle. */
    refuse(id, ctx) {
      purge();
      const rec = parked.get(id);
      if (!rec || !mayDecide(rec, ctx)) return false;
      return parked.delete(id);
    },

    /** The calls this account is waiting on. */
    pending(account) {
      purge();
      return [...parked.values()].filter((r) => r.account === account).map(view);
    },

    /** Requests from people that an admin can answer. */
    awaiting() {
      purge();
      return [...parked.values()].filter((r) => r.status === "requested").map((r) => ({ ...view(r), account: r.account, by: r.by }));
    },
  };
}

const view = (r) => ({ id: r.id, capId: r.capId, status: r.status, preview: clone(r.preview), createdAt: r.createdAt });

function mayDecide(rec, ctx) {
  if (ctx?.admin !== true) return false;
  return rec.status === "requested" || rec.account === ctx.account;
}
