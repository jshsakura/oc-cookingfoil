/**
 * The chat's HTTP routes, one contract for two audiences:
 *   /admin/api/chat  the admin (mountChatApi): the admin session, the full tool table, and the
 *                    requests people sent waiting in its list. An automation token is turned away
 *                    by requireSession (tokenBlocked lists /api/chat), since the chat is a person's tool.
 *   /api/chat        a person signed in on the web page (routes/chat.js): only the user allowlist
 *                    (chat/policy.js USER_TIERS), their own conversations, a cap on messages.
 * Both are off (404) until the chatEnabled setting is on.
 *
 *   GET    <base>               { configured, name, window, conversations: [{ id, title, updated }], pending: [...] }
 *                               the admin's pending holds its own waiting calls and then people's requests (with `by`)
 *   GET    <base>?status=1      { configured, name }   so a page can tell the chat is on before showing it
 *   GET    <base>?id=<id>       { messages, context: { used, window } }   404 when that conversation is not the caller's
 *   POST   <base>               { message, conversation? }  a stream of JSON lines, one event each: text, tool_start,
 *                               tool_end, approval, compacting, context, error, done. 413 when the message is too long
 *   POST   <base>/compact       { conversation }  sums the conversation up for the model → { used, window }
 *   POST   <base>/decision      { id, approve, conversation? }  settle a call that waits for approval (admin only)
 *   DELETE <base>?id=<id>       delete one conversation
 *   POST   /admin/api/chat/attach   the admin's attach button: files into the share inbox, as /api/inbox takes
 *                               them (routes/inbox.js), answered { id, items: [{ name, size }] }. People attach
 *                               through /api/inbox itself.
 *
 * A call waiting for approval is kept in memory and is gone after a restart.
 */
import * as env from "../../helpers/envs.js";
import { chatService, ChatError } from "../../chat/service.js";
import { personaFromSettings } from "../../chat/persona.js";
import { tooManyRequests } from "../../security/retry-after.js";
import debug from "../../debug.js";
import { inboxUpload } from "../inbox.js";

// There is one admin session and no account behind it, so the chat's account is fixed.
const ADMIN = { account: "admin", owner: "admin", admin: true, name: "admin" };

/**
 * Mounts the routes at `path`. `whoOf(req, res)` answers the caller ({ account, owner, admin, name })
 * or null after it has answered the request itself; `limit(who)` is null to go on or the seconds to
 * wait before another model call.
 */
export function mountChatRoutes(router, { path, whoOf, service, enabled, limit = () => null, label = "chat" }) {
  const handle = (fn) => async (req, res) => {
    const who = whoOf(req, res);
    if (!who) return;
    res.set("Cache-Control", "no-store");
    if (!enabled()) return res.status(404).json({ error: "the chat is off" });
    try {
      await fn(req, res, service(), who);
    } catch (err) {
      if (err instanceof ChatError) return res.headersSent ? res.end() : res.status(err.status).json({ error: err.message, code: err.code });
      debug.error("%s: %s", label, err?.stack ?? err);
      if (res.headersSent) return res.end();
      res.status(500).json({ error: "the chat failed" });
    }
  };
  const idOf = (req) => (typeof req.query.id === "string" ? req.query.id : "");
  const limited = (res, who) => {
    const wait = limit(who);
    if (wait === null) return false;
    tooManyRequests(res, wait).json({ error: `too many messages; try again in ${wait} seconds`, code: "rate" });
    return true;
  };

  router.get(path, handle(async (req, res, chat, who) => {
    const name = personaFromSettings().name;
    // The floating chat asks this on every page: no listing, only whether it may show itself.
    if (req.query.status !== undefined) return res.json({ configured: chat.configured(), name });
    const id = idOf(req);
    if (id) return res.json({ messages: chat.load(who.account, id), context: chat.context(who.account, id) });
    const pending = await chat.pending(who.account);
    res.json({
      configured: chat.configured(), name, window: env.chatContextTokens, conversations: chat.list(who.account),
      pending: who.admin ? [...pending, ...await chat.requests(who.account)] : pending,
    });
  }));

  router.post(path, handle(async (req, res, chat, who) => {
    if (limited(res, who)) return;
    const { message, conversation } = req.body ?? {};
    const abort = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) abort.abort();
    });
    // The answer starts only once the request is accepted, so a refusal is still a plain JSON error.
    let started = false;
    const send = (event) => {
      if (!started) {
        started = true;
        res.status(200).set({ "Content-Type": "application/x-ndjson; charset=utf-8", "X-Accel-Buffering": "no" }).flushHeaders();
      }
      if (!res.writableEnded) res.write(`${JSON.stringify(event)}\n`);
    };
    await chat.turn({ ...who, conversation: typeof conversation === "string" ? conversation : undefined, message, onEvent: send, signal: abort.signal });
    res.end();
  }));

  router.post(`${path}/compact`, handle(async (req, res, chat, who) => {
    const { conversation } = req.body ?? {};
    if (typeof conversation !== "string") throw new ChatError("bad_request", "conversation is needed");
    if (limited(res, who)) return;
    res.json(await chat.compact({ account: who.account, admin: who.admin, conversation }));
  }));

  router.post(`${path}/decision`, handle(async (req, res, chat, who) => {
    const { id, approve, conversation } = req.body ?? {};
    if (typeof id !== "string" || typeof approve !== "boolean") throw new ChatError("bad_request", "id and approve are needed");
    res.json(await chat.decide({ account: who.account, admin: who.admin, id, approve, conversation: typeof conversation === "string" ? conversation : undefined }));
  }));

  router.delete(path, handle(async (req, res, chat, who) => {
    if (!chat.remove(who.account, idOf(req))) throw new ChatError("no_conversation", "no such conversation", 404);
    res.json({ ok: true });
  }));
}

export function mountChatApi(router, requireSession, { service = () => chatService(env.dataDir), enabled = () => env.chatEnabled } = {}) {
  mountChatRoutes(router, { path: "/api/chat", whoOf: (req, res) => (requireSession(req, res) ? ADMIN : null), service, enabled, label: "admin: chat" });
  // The admin router checks the origin of every write; the admin is not told of their own upload.
  const attach = inboxUpload({ whoOf: () => ({ name: "admin", label: "admin", slug: "admin" }), csrf: () => true, notify: () => {} });
  router.post("/api/chat/attach", (req, res) => (requireSession(req, res) ? attach(req, res) : undefined));
}
