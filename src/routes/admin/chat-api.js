/**
 * The admin chat. Off until the chatEnabled setting is on, and only for a signed-in admin: an
 * automation token is turned away by requireSession (tokenBlocked lists /api/chat), since the chat
 * is a person's tool and not one an agent may call.
 *
 *   GET    /admin/api/chat               { configured, conversations: [{ id, title, updated }], pending: [...] }
 *   GET    /admin/api/chat?id=<id>       { messages }              404 when that conversation is not the admin's
 *   POST   /admin/api/chat               { message, conversation? }  a stream of JSON lines, one event each, ending
 *                                        with { type: "done" }: text, tool_start, tool_end, approval, error
 *   POST   /admin/api/chat/decision      { id, approve, conversation? }  settle a call that waits for approval
 *   DELETE /admin/api/chat?id=<id>       delete one conversation
 *
 * A call waiting for approval is kept in memory and is gone after a restart.
 */
import * as env from "../../helpers/envs.js";
import { chatService, ChatError } from "../../chat/service.js";
import debug from "../../debug.js";

// There is one admin session and no account behind it, so the chat's account is fixed.
const ACCOUNT = "admin";
const WHO = { account: ACCOUNT, admin: true, name: "admin" };

export function mountChatApi(router, requireSession, { service = () => chatService(env.dataDir), enabled = () => env.chatEnabled } = {}) {
  const guard = (req, res) => {
    if (!requireSession(req, res)) return false;
    res.set("Cache-Control", "no-store");
    if (!enabled()) {
      res.status(404).json({ error: "the chat is off" });
      return false;
    }
    return true;
  };
  const handle = (fn) => async (req, res) => {
    if (!guard(req, res)) return;
    try {
      await fn(req, res, service());
    } catch (err) {
      if (err instanceof ChatError) return res.headersSent ? res.end() : res.status(err.status).json({ error: err.message, code: err.code });
      debug.error("admin: chat: %s", err?.stack ?? err);
      if (res.headersSent) return res.end();
      res.status(500).json({ error: "the chat failed" });
    }
  };
  const idOf = (req) => (typeof req.query.id === "string" ? req.query.id : "");

  router.get("/api/chat", handle(async (req, res, chat) => {
    const id = idOf(req);
    if (id) return res.json({ messages: chat.load(ACCOUNT, id) });
    res.json({ configured: chat.configured(), conversations: chat.list(ACCOUNT), pending: await chat.pending(ACCOUNT) });
  }));

  router.post("/api/chat", handle(async (req, res, chat) => {
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
    await chat.turn({ ...WHO, conversation: typeof conversation === "string" ? conversation : undefined, message, onEvent: send, signal: abort.signal });
    res.end();
  }));

  router.post("/api/chat/decision", handle(async (req, res, chat) => {
    const { id, approve, conversation } = req.body ?? {};
    if (typeof id !== "string" || typeof approve !== "boolean") throw new ChatError("bad_request", "id and approve are needed");
    res.json(await chat.decide({ ...WHO, id, approve, conversation: typeof conversation === "string" ? conversation : undefined }));
  }));

  router.delete("/api/chat", handle(async (req, res, chat) => {
    if (!chat.remove(ACCOUNT, idOf(req))) throw new ChatError("no_conversation", "no such conversation", 404);
    res.json({ ok: true });
  }));
}
