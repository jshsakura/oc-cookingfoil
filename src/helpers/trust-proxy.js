// COOK_TRUST_PROXY decides which hops may set the client address via
// X-Forwarded-For. "true" trusts every hop (only safe when nothing can reach
// the server except through the proxy). A list such as "loopback, uniquelocal"
// trusts only those hops, so a client cannot spoof its address through a
// tunnel that appends the real one (cloudflared, nginx).
import express from "express";
import { envString } from "./env-read.js";

const BOOLEAN = { true: true, 1: true, yes: true, on: true, false: false, 0: false, no: false, off: false };

export function parseTrustProxy(raw) {
  const value = String(raw ?? "").trim();
  if (!value) return false;
  const lowered = value.toLowerCase();
  if (lowered in BOOLEAN) return BOOLEAN[lowered];
  return value;
}

export const trustProxy = parseTrustProxy(envString("COOK_TRUST_PROXY"));

// The same rule Express applies to req.ip, compiled once so code that sees a
// raw request (the WebSocket upgrade) or reads a forwarded header itself asks
// the same question.
const trustFn = express().set("trust proxy", trustProxy).get("trust proxy fn");

/**
 * Whether the connection's peer is a proxy allowed to speak for the client
 * (COOK_TRUST_PROXY), so its X-Forwarded-Host/-Proto may be believed. Decided
 * by the socket address, never by a header.
 */
export function trustsForwardedHeaders(req, fn = trustFn) {
  const peer = req?.socket?.remoteAddress;
  return Boolean(peer) && Boolean(fn(peer, 0));
}

/**
 * The client address of a raw request (no Express req.ip), by the rule
 * Express uses: walk X-Forwarded-For from the socket back toward the client
 * and stop at the first hop that is not trusted. ::ffff: is stripped.
 */
export function clientAddress(req, fn = trustFn) {
  const peer = req?.socket?.remoteAddress;
  if (!peer) return "unknown";
  const forwarded = String(req.headers?.["x-forwarded-for"] ?? "").split(",").map((s) => s.trim()).filter(Boolean).reverse();
  const hops = [peer, ...forwarded];
  let i = 0;
  while (i < hops.length - 1 && fn(hops[i], i)) i++;
  return hops[i].replace(/^::ffff:/, "");
}
