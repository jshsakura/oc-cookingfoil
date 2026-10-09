// COOK_TRUST_PROXY decides which hops may set the client address via
// X-Forwarded-For. "true" trusts every hop (only safe when nothing can reach
// the server except through the proxy). A list such as "loopback, uniquelocal"
// trusts only those hops, so a client cannot spoof its address through a
// tunnel that appends the real one (cloudflared, nginx).
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
