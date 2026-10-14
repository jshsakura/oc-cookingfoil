/**
 * Is a socket peer this machine itself: loopback, or the container's default
 * gateway (the docker bridge, through which a proxy on the host reaches a
 * container)? Read once from /proc/net/route; where that file is missing
 * (not Linux) only loopback counts.
 */
import fs from "fs";
import { isLoopbackIp } from "./net.js";

const ROUTE_FILE = "/proc/net/route";

/** The default gateways in a /proc/net/route table, as dotted IPv4. Pure. */
export function defaultGateways(table) {
  const out = [];
  for (const line of String(table).split("\n").slice(1)) {
    const [, dest, gw] = line.trim().split(/\s+/);
    if (dest !== "00000000" || !/^[0-9A-F]{8}$/i.test(gw ?? "")) continue;
    // Little-endian hex: 0100A8C0 is 192.168.0.1.
    const bytes = gw.match(/../g).map((h) => parseInt(h, 16)).reverse();
    out.push(bytes.join("."));
  }
  return out;
}

let gateways = null;

function knownGateways() {
  if (gateways) return gateways;
  try {
    gateways = new Set(defaultGateways(fs.readFileSync(ROUTE_FILE, "utf8")));
  } catch {
    gateways = new Set();
  }
  return gateways;
}

export function isLocalHop(ip) {
  const v4 = String(ip ?? "").replace(/^::ffff:/, "");
  return isLoopbackIp(v4) || knownGateways().has(v4);
}

/** Tests name the gateways. */
export function setGatewaysForTests(list) {
  gateways = new Set(list);
}
