/**
 * Admin endpoints — gated by a SEPARATE bearer token (COOK_ADMIN_TOKEN),
 * not the shop's basic-auth users. Disabled entirely when the token isn't
 * set, so out-of-the-box there's no admin surface to attack.
 *
 *   GET  /api/admin/status        → counts + last 100 audit events
 *   POST /api/admin/unlock {ip}   → unlock a specific IP, or "all"
 */
import express from "express";
import debug from "../debug.js";
import * as store from "../security/store.js";

const ADMIN_TOKEN = process.env.COOK_ADMIN_TOKEN || "";

function checkToken(req, res) {
  if (!ADMIN_TOKEN) {
    res.status(404).end();
    return false;
  }
  const header = req.get("authorization") || "";
  const expected = "Bearer " + ADMIN_TOKEN;
  if (header.length !== expected.length || !timingSafeEqual(header, expected)) {
    res.status(401).type("text/plain").send("invalid admin token");
    return false;
  }
  return true;
}

function timingSafeEqual(a, b) {
  let diff = a.length ^ b.length;
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export default function adminRouter() {
  const r = express.Router();
  r.use(express.json({ limit: "16kb" }));

  r.get("/status", (req, res) => {
    if (!checkToken(req, res)) return;
    res.json(store.snapshot());
  });

  r.post("/unlock", (req, res) => {
    if (!checkToken(req, res)) return;
    const { ip } = req.body || {};
    if (ip === "all") {
      const snap = store.snapshot();
      let n = 0;
      for (const l of snap.lockouts) {
        if (store.unlock(l.ip)) n++;
      }
      debug.log("admin: unlocked %d IPs (bulk)", n);
      return res.json({ unlocked: n });
    }
    if (typeof ip !== "string" || !ip) {
      return res.status(400).json({ error: "supply ip='<addr>' or ip='all'" });
    }
    const ok = store.unlock(ip);
    debug.log("admin: unlock %s → %s", ip, ok);
    res.json({ unlocked: ok ? 1 : 0, ip });
  });

  return r;
}

export const adminEnabled = ADMIN_TOKEN.length > 0;
