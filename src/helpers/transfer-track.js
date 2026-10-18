/**
 * The request side of the download records (transfer-log.js): mounted where
 * downloads are answered, it tells the recorder who asked for which file, which
 * way the request came in, and how many bytes really went out.
 *
 * A request counts as a download by the rule the restart status uses
 * (drain.js): a Range request, or a response of a megabyte or more. A response
 * with no Content-Length (a streamed bundle) counts once that much has gone out.
 *
 * Bytes are the socket's bytesWritten when the response closes minus what it
 * was when the request reached us, less the response head. A request that is
 * cut off counts what had gone out by then. Nothing runs per chunk.
 *
 * Route:
 *   direct  answered by the direct address's lane (direct-lane.js marks it)
 *   tunnel  carries Cloudflare's headers (CF-Ray or CF-Connecting-IP)
 *   lan     the socket peer is a private, loopback or link-local address
 *   other   anything else
 * The route is decided by the socket peer and the lane, never by
 * X-Forwarded-For; the client's own address (req.ip, or the one the direct
 * proxy wrote) only says whether the requester is at home or outside.
 */
import net from "node:net";
import path from "node:path";
import transferLog from "./transfer-log.js";
import { countsAsDownload, DOWNLOAD_BYTES } from "../security/drain.js";
import { isLoopbackIp, isPrivateIp, socketIp } from "../security/net.js";
import { accountOf } from "../security/link-identity.js";
import * as store from "../security/store.js";

const CLIENT_CHARS = 80;
const PREFIX = 8;

/** Whether a socket peer is on this machine or the home network: private, loopback or link-local. Pure. */
export function isLanPeer(ip) {
  const a = String(ip ?? "").replace(/^::ffff:/, "");
  if (isLoopbackIp(a)) return true;
  if (net.isIPv4(a)) {
    const [p, q] = a.split(".").map(Number);
    return p === 10 || (p === 172 && q >= 16 && q <= 31) || (p === 192 && q === 168) || (p === 169 && q === 254);
  }
  return net.isIPv6(a) && /^(f[cd][0-9a-f]{2}|fe[89ab][0-9a-f]):/i.test(a);
}

/** "direct", "tunnel", "lan" or "other" for a request's lane, headers and socket peer. Pure. */
export function routeOf({ lane = null, headers = {}, peer = "" } = {}) {
  if (lane === "direct") return "direct";
  if (headers["cf-ray"] || headers["cf-connecting-ip"]) return "tunnel";
  if (isLanPeer(peer)) return "lan";
  return "other";
}

// Approved consoles' names, read again at most once a minute (a download is many requests).
let labels = { at: -Infinity, map: new Map() };
const LABELS_MS = 60_000;

function deviceLabel(dev) {
  const prefix = dev.slice(0, PREFIX).toLowerCase();
  if (Date.now() - labels.at > LABELS_MS) {
    labels = { at: Date.now(), map: new Map(store.devicesSnapshot().approved.map((d) => [d.deviceKey, d.label])) };
  }
  const label = labels.map.get(dev);
  return { prefix, label: label ? `${label} (${prefix})` : `기기 ${prefix}` };
}

/**
 * Who asked: the console's device key, else the account (per-device login, a
 * shop account, a Google account), else the client's address. Only a device
 * key the console proved counts (its access key, or a session made for it:
 * req.pairedDevice); an X-Device-Key header alone is anyone's to write, so
 * without that proof the account or the address names the request. `key`
 * groups requests and never leaves memory; `id` and `label` are what is kept and shown.
 */
export function requesterOf(req, clientIp) {
  const sub = req.cookingfoilLane === "direct" ? req.directSub : null;
  const dev = sub ? sub.dev : (req.pairedDevice ?? null);
  const acct = sub ? sub.acct : accountOf(req);
  if (dev) {
    const { prefix, label } = deviceLabel(dev);
    return { key: `dev:${dev}`, kind: "device", id: prefix, label };
  }
  if (acct) {
    const google = acct.kind === "google";
    const id = google ? String(acct.id).slice(0, PREFIX) : String(acct.id);
    return { key: `acct:${acct.kind}:${acct.id}`, kind: "account", id, label: google ? `Google ${id}` : id };
  }
  return { key: `ip:${clientIp}`, kind: "ip", id: clientIp, label: clientIp };
}

/** The requester's own address: the one the direct proxy wrote, Cloudflare's, or req.ip. */
function clientIpOf(req, route) {
  if (req.directClient) return req.directClient;
  const cf = String(req.get("cf-connecting-ip") ?? "").trim();
  if (route === "tunnel" && net.isIP(cf)) return cf;
  return String(req.ip || socketIp(req)).replace(/^::ffff:/, "");
}

function remoteOf(req, route, ip) {
  const country = route === "tunnel" ? String(req.get("cf-ipcountry") ?? "").toUpperCase() : "";
  return { scope: isPrivateIp(ip) ? "private" : "public", country: /^[A-Z0-9]{2}$/.test(country) ? country : null };
}

function pathOf(req) {
  const raw = String(req.originalUrl ?? req.url ?? "").split("?")[0];
  try { return decodeURIComponent(raw); } catch { return raw; }
}

/** The file name a Content-Disposition header gives, or null. Pure. */
export function dispositionName(header) {
  const h = String(header ?? "");
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(h);
  if (star) {
    try { return decodeURIComponent(star[1].trim()); } catch { /* fall back to the plain name */ }
  }
  const plain = /filename\s*=\s*"([^"]*)"|filename\s*=\s*([^;]+)/.exec(h);
  const name = plain ? (plain[1] ?? plain[2]).trim() : "";
  return name || null;
}

const written = (sock) => Number(sock?.bytesWritten ?? sock?._bytesDispatched ?? 0) || 0;
// The status line and headers Node wrote ahead of the body.
const headBytes = (res) => (typeof res._header === "string" ? Buffer.byteLength(res._header) : 0);

/** { start, size } of a 206's Content-Range, or of a whole 200 response. Pure. */
export function extentOf(status, contentRange, contentLength) {
  if (status === 206) {
    const m = /^bytes (\d+)-\d+\/(\d+|\*)$/.exec(String(contentRange ?? ""));
    return m ? { start: Number(m[1]), size: m[2] === "*" ? null : Number(m[2]) } : { start: 0, size: null };
  }
  const n = Number(contentLength);
  return { start: 0, size: Number.isFinite(n) && n > 0 ? n : null };
}

/** Starts recording `req` with `log`; ends itself when the response closes. */
export function track(req, res, log = transferLog) {
  if (req.cookingfoilTransfer) return;
  req.cookingfoilTransfer = true;
  const sock = req.socket;
  const base = written(sock);
  const route = routeOf({ lane: req.cookingfoilLane, headers: req.headers, peer: socketIp(req) });
  const ip = clientIpOf(req, route);
  const who = requesterOf(req, ip);
  const filePath = pathOf(req);
  const probe = () => Math.max(0, written(sock) - base - headBytes(res));
  const handle = log.begin({
    key: `${route}|${who.key}|${filePath}`,
    route,
    file: { path: filePath, name: path.posix.basename(filePath) || filePath },
    client: String(req.get("user-agent") ?? "").trim().slice(0, CLIENT_CHARS),
    who: { kind: who.kind, id: who.id, label: who.label },
    remote: remoteOf(req, route, ip),
    ranged: Boolean(req.headers.range),
  }, probe);
  res.once("close", () => {
    const sent = probe();
    const status = res.statusCode;
    const ok = status === 200 || status === 206;
    const { start, size } = extentOf(status, res.getHeader("content-range"), res.getHeader("content-length"));
    log.end(handle, {
      download: ok && (countsAsDownload(req, res) || sent >= DOWNLOAD_BYTES),
      sent,
      size,
      start,
      name: dispositionName(res.getHeader("content-disposition")),
    });
  });
}

/**
 * Middleware that records the GET requests it sees (HEAD sends no body).
 * `match(path)` narrows it to the paths that are downloads.
 */
export function trackTransfers({ match = () => true, log = transferLog } = {}) {
  return (req, res, next) => {
    if (req.method === "GET" && match(pathOf(req))) track(req, res, log);
    next();
  };
}
