/**
 * Is a request coming from the home network?
 *
 * Direct links (download-links.js) only make sense, and are only handed out,
 * to a console in the same house as the server:
 *
 *   - through the tunnel (CF-Connecting-IP present): the client's address
 *     equals this house's public address. The trusted client address is
 *     req.ip (with trust proxy); when that is only the tunnel connector on this
 *     machine or LAN, Cloudflare's CF-Connecting-IP is the client.
 *   - directly (no CF-Connecting-IP): the client is on a private or loopback
 *     address.
 *
 * The public address is the admin's homePublicIp (COOK_HOME_PUBLIC_IP) when
 * set, else what startPublicIpWatch() learns from Cloudflare's trace page
 * (ipify as a fallback) every ten minutes.
 */
import net from "net";
import * as env from "../helpers/envs.js";
import { clientIp } from "./deny.js";
import { isPrivateIp } from "./net.js";
import debug from "../debug.js";

const WATCH_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;
const TRACE_URL = "https://1.1.1.1/cdn-cgi/trace";
const IPIFY_URL = "https://api.ipify.org";

let detected = null;

const cfClient = (req) => String(req.get("cf-connecting-ip") ?? "").trim();

/** This house's public address, or null while unknown. */
export function homePublicIp() {
  return env.homePublicIp || detected;
}

/** A connection straight from the LAN: no tunnel in between, from a private or loopback address. */
export function isDirectLan(req) {
  return !cfClient(req) && isPrivateIp(clientIp(req));
}

export function isHome(req) {
  const cf = cfClient(req);
  if (!cf) return isPrivateIp(clientIp(req));
  const pub = homePublicIp();
  if (!pub) return false;
  const ip = clientIp(req);
  return (isPrivateIp(ip) ? cf : ip) === pub;
}

/** The address in a Cloudflare trace ("ip=…" line) or a bare ipify reply, or null. Pure. */
export function parsePublicIp(text) {
  const line = /^ip=(.+)$/m.exec(text)?.[1] ?? text;
  const ip = String(line).trim();
  return net.isIP(ip) ? ip : null;
}

async function fetchText(url, fetchImpl) {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.text();
}

/** Asks Cloudflare, then ipify, for this house's public address; keeps the last one on failure. */
export async function detectPublicIp(fetchImpl = fetch) {
  for (const url of [TRACE_URL, IPIFY_URL]) {
    try {
      const ip = parsePublicIp(await fetchText(url, fetchImpl));
      if (!ip) continue;
      if (ip !== detected) debug.log("home network: public address is %s", ip);
      detected = ip;
      return ip;
    } catch (err) {
      debug.error("home network: %s: %s", url, err.message);
    }
  }
  return detected;
}

/** Learns the public address now and every ten minutes, while direct links are on and no address is set by hand. */
export function startPublicIpWatch(fetchImpl = fetch) {
  const tick = () => (env.directBaseUrl && !env.homePublicIp ? detectPublicIp(fetchImpl) : null);
  tick();
  setInterval(tick, WATCH_MS).unref();
}

/** Tests set the detected address directly. */
export function setDetectedForTests(ip) {
  detected = ip;
}
