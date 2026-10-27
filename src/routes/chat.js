/**
 * The chat for people signed in on the web page, at /api/chat, with the same contract as
 * /admin/api/chat (routes/admin/chat-api.js). Whoever asks, it runs as a person and not as the
 * admin, even for an admin account: the admin's chat stays behind the admin page's own sign-in.
 *
 * The caller is the web sign-in (cf_user cookie), never a console's keys or an automation token.
 * Their conversations live under `user:<account>`, so no account name can reach the admin's
 * folder, and the tools act as that account (its wishlist). A write carries the page's CSRF token
 * (the router's sameOriginWrites also checks the origin). Each account may start RATE_MAX model
 * calls (a message or a compaction) per RATE_WINDOW_MS.
 */
import express from "express";
import * as env from "../helpers/envs.js";
import { chatService } from "../chat/service.js";
import { csrfOk, webUser } from "../security/user-session.js";
import { createKeyRate } from "../security/key-rate.js";
import { mountChatRoutes } from "./admin/chat-api.js";

export const RATE_MAX = 20;
export const RATE_WINDOW_MS = 10 * 60 * 1000;
const SAFE = new Set(["GET", "HEAD"]);

/** The person behind a web request as the chat sees them, or null when nobody is signed in on the web. */
export function chatWho(req) {
  if (req.apiToken || req.pairedDevice || req.sessionLane) return null;
  const who = webUser(req);
  if (!who?.approver) return null;
  return { account: `user:${who.approver}`, owner: who.approver, admin: false, name: who.kind === "password" ? who.name : "" };
}

export default function userChatRouter({ service = () => chatService(env.dataDir), enabled = () => env.chatEnabled, whoOf = chatWho, rate = createKeyRate({ max: RATE_MAX, windowMs: RATE_WINDOW_MS }) } = {}) {
  const router = express.Router();
  router.use("/api/chat", express.json({ limit: "64kb" }));
  mountChatRoutes(router, {
    path: "/api/chat",
    label: "chat",
    service,
    enabled,
    whoOf: (req, res) => {
      res.set("Cache-Control", "no-store");
      const who = whoOf(req);
      if (!who) {
        res.status(401).json({ error: "sign in first" });
        return null;
      }
      if (!SAFE.has(req.method) && !csrfOk(req)) {
        res.status(403).json({ error: "csrf token missing or wrong" });
        return null;
      }
      return who;
    },
    limit: (who) => {
      const hit = rate.hit(who.account);
      return hit.ok ? null : hit.retryAfterSec;
    },
  });
  return router;
}
