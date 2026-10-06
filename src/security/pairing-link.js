import crypto from "node:crypto";
const LIFETIME_MS = 10 * 60 * 1000;
const LIMIT = 512;
const links = new Map();
const byDevice = new Map();
function remove(token, link) {
  links.delete(token);
  if (byDevice.get(link.deviceKey) === token) byDevice.delete(link.deviceKey);
}
function prune(now) {
  for (const [token, link] of links) if (now >= link.expiresAt) remove(token, link);
}
export function issuePairLink(deviceKey, now = Date.now()) {
  prune(now);
  const token = byDevice.get(deviceKey);
  const previous = links.get(token);
  if (previous && !previous.used) return { token, expiresAt: previous.expiresAt, code: previous.code };
  while (links.size >= LIMIT) {
    const [oldToken, oldLink] = links.entries().next().value;
    remove(oldToken, oldLink);
  }
  const next = crypto.randomBytes(16).toString("hex");
  const code = crypto.createHash("sha256").update(deviceKey).digest("hex").slice(0, 8).toUpperCase();
  const link = { deviceKey, code, expiresAt: now + LIFETIME_MS, used: false };
  links.set(next, link);
  byDevice.set(deviceKey, next);
  return { token: next, expiresAt: link.expiresAt, code };
}
export function readPairLink(token, now = Date.now()) {
  prune(now);
  if (typeof token !== "string" || !/^[a-f0-9]{32}$/.test(token)) return null;
  const link = links.get(token);
  return link ? { ...link } : null;
}
export function finishPairLink(token, now = Date.now()) {
  const link = readPairLink(token, now);
  if (!link || link.used) return false;
  links.get(token).used = true;
  return true;
}
