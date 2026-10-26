/**
 * What a plugin may put on a response it helps make (beforeDownload, a route of its own). The core
 * builds the header lines: a plugin gives values, never the framing.
 *
 *   safeHeaders(headers)        -> { name: value } | null    only X-* names, small, no line breaks; null if any is not
 *   dispositionOf(filename)     -> header value | null       attachment with a filename and an RFC 6266 filename*; null if unsafe
 */
const NAME_RE = /^x-[a-z0-9-]{1,40}$/i;
const MAX_HEADERS = 8;
const MAX_VALUE = 256;
const MAX_FILENAME = 200;
// Core's own headers keep their names: a plugin cannot answer as the core.
const RESERVED_PREFIX = "x-cookingfoil-";

export function safeHeaders(headers) {
  if (headers === undefined) return {};
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) return null;
  const entries = Object.entries(headers);
  if (entries.length > MAX_HEADERS) return null;
  const out = {};
  for (const [name, value] of entries) {
    if (!NAME_RE.test(name) || name.toLowerCase().startsWith(RESERVED_PREFIX)) return null;
    if (typeof value !== "string" || value.length > MAX_VALUE || /[\r\n\0]/.test(value)) return null;
    out[name] = value;
  }
  return out;
}

export function dispositionOf(filename) {
  if (typeof filename !== "string" || !filename || filename.length > MAX_FILENAME) return null;
  if (/[\r\n\0"\\/]/.test(filename)) return null;
  const ascii = filename.replace(/[^\x20-\x7e]|%/g, "_");
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
