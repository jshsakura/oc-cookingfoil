/**
 * Outbound URLs an operator sets (the titledb source, the
 * direct download address) must not point the server at its own network: an
 * admin session that is stolen, or a typo, would otherwise turn the server
 * into a probe of the LAN, the docker bridge or a cloud metadata service.
 *
 * Refused: loopback, RFC1918, CGNAT, link-local (cloud metadata lives there),
 * unique-local and other non-public ranges, IPv4-mapped/NAT64 forms of them.
 * Checked when the admin saves a URL and again at fetch time after DNS
 * resolution, and on every redirect hop, so a public-looking name that
 * resolves to a private address is refused too. (fetch resolves the name once
 * more itself; the window between the two lookups is accepted.)
 *
 * COOK_OUTBOUND_PRIVATE_HOSTS (env only, never the admin page: a stolen
 * session must not be able to widen it) names hosts that may resolve to a
 * private, loopback or CGNAT address, such as a titledb mirror on a tailnet.
 * Link-local and metadata addresses stay refused even for those.
 */
import dns from "node:dns/promises";
import net from "node:net";
import { envString } from "../helpers/env-read.js";
import { securityText } from "./security-messages.js";

/** A refused address: English message, `code` (security-messages key) and `reason` (what was refused). */
export class OutboundError extends Error {
  constructor(code, reason) {
    super(securityText("en", code));
    this.code = code;
    this.vars = {};
    this.reason = reason;
  }
}

const ranges = (list) => {
  const block = new net.BlockList();
  for (const [addr, prefix, type] of list) block.addSubnet(addr, prefix, type);
  return block;
};

// Never reachable, not even for a host the operator listed.
const ALWAYS = ranges([
  ["169.254.0.0", 16, "ipv4"], // link-local, cloud metadata (169.254.169.254)
  ["0.0.0.0", 8, "ipv4"],
  ["224.0.0.0", 4, "ipv4"], // multicast
  ["240.0.0.0", 4, "ipv4"], // reserved, broadcast
  ["fe80::", 10, "ipv6"], // link-local
  ["fec0::", 10, "ipv6"], // site-local (deprecated)
  ["ff00::", 8, "ipv6"], // multicast
  ["::", 128, "ipv6"],
]);
// Metadata services outside link-local.
const METADATA = new Set(["fd00:ec2::254", "100.100.100.200"]);
// The operator's own networks: refused unless the host is listed.
const PRIVATE = ranges([
  ["127.0.0.0", 8, "ipv4"],
  ["10.0.0.0", 8, "ipv4"],
  ["172.16.0.0", 12, "ipv4"],
  ["192.168.1.0", 16, "ipv4"],
  ["100.64.0.0", 10, "ipv4"], // CGNAT (Tailscale et al.)
  ["192.0.0.0", 24, "ipv4"], // IETF protocol assignments
  ["198.18.0.0", 15, "ipv4"], // benchmarking
  ["::1", 128, "ipv6"],
  ["fc00::", 7, "ipv6"], // unique-local (fd00:ec2::254 among them)
]);

/** The IPv4 address embedded in an IPv4-mapped or NAT64 IPv6 address, or null. */
function embeddedV4(ip) {
  const m = /^(?:::ffff:|64:ff9b::)(?:(\d+\.\d+\.\d+\.\d+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/i.exec(ip);
  if (!m) return null;
  if (m[1]) return m[1];
  const hi = parseInt(m[2], 16);
  const lo = parseInt(m[3], 16);
  return [hi >> 8, hi & 255, lo >> 8, lo & 255].join(".");
}

/**
 * Why an address may not be fetched: "metadata" (never), "private" (only for
 * a listed host), or null when it is public. Pure.
 */
export function blockedReason(address) {
  const ip = String(address ?? "").replace(/^\[|\]$/g, "").replace(/%.*$/, "").toLowerCase();
  const type = net.isIP(ip);
  if (!type) return "metadata"; // not an address at all: refuse outright
  const v4 = type === 6 ? embeddedV4(ip) : ip;
  if (v4 && v4 !== ip) return blockedReason(v4);
  const family = type === 4 ? "ipv4" : "ipv6";
  if (METADATA.has(ip) || ALWAYS.check(ip, family)) return "metadata";
  if (PRIVATE.check(ip, family)) return "private";
  return null;
}

const listed = (raw) => new Set(String(raw ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
const PRIVATE_HOSTS = listed(envString("COOK_OUTBOUND_PRIVATE_HOSTS", ""));

let defaultLookup = (host) => dns.lookup(host, { all: true, verbatim: true });

/** Test-only: answer name lookups without DNS. `fn(host)` → [{ address }]. */
export function setLookupForTests(fn) {
  defaultLookup = fn ?? ((host) => dns.lookup(host, { all: true, verbatim: true }));
}

/**
 * Resolve `raw` and refuse it when any address it resolves to is not public.
 * @returns {Promise<{ url: URL, addresses: string[] }>}
 * @throws {OutboundError} with an English message and a code the route translates
 */
export async function checkOutboundUrl(raw, { lookup = defaultLookup, privateHosts = PRIVATE_HOSTS } = {}) {
  let url;
  try {
    url = new URL(String(raw));
  } catch {
    throw new OutboundError("outbound.invalid", "invalid");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new OutboundError("outbound.invalid", "invalid");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  let addresses;
  if (net.isIP(host)) {
    addresses = [host];
  } else {
    try {
      addresses = (await lookup(host)).map((a) => (typeof a === "string" ? a : a.address));
    } catch {
      throw new OutboundError("outbound.unresolved", "unresolved");
    }
    if (!addresses.length) throw new OutboundError("outbound.unresolved", "unresolved");
  }
  const mayBePrivate = privateHosts.has(host);
  for (const address of addresses) {
    const reason = blockedReason(address);
    if (reason === "metadata" || (reason === "private" && !mayBePrivate)) throw new OutboundError("outbound.blocked", reason);
  }
  return { url, addresses };
}

const REDIRECT = new Set([301, 302, 303, 307, 308]);

/**
 * fetch() that checks the URL, and every redirect hop, with checkOutboundUrl.
 * Redirects are followed by hand (at most `maxRedirects`).
 * @throws {OutboundError} when a hop is refused
 */
export async function guardedFetch(url, options = {}, { fetchImpl = fetch, lookup = defaultLookup, privateHosts = PRIVATE_HOSTS, maxRedirects = 5 } = {}) {
  let at = String(url);
  for (let hop = 0; hop <= maxRedirects; hop++) {
    await checkOutboundUrl(at, { lookup, privateHosts });
    const res = await fetchImpl(at, { ...options, redirect: "manual" });
    const next = REDIRECT.has(res.status) ? res.headers?.get?.("location") : null;
    if (!next) return res;
    await res.body?.cancel?.().catch(() => {});
    at = new URL(next, at).href;
  }
  throw new OutboundError("outbound.redirects", "redirects");
}
