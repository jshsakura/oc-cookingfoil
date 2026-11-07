/**
 * How the kept firmware list (firmware/service.js) reads to a console and to the admin page.
 * All pure: `s` is the state ({ versions, ... }), never changed here.
 */
import { newestFirst } from "./versions.js";

/** An epoch ms as "2026-11-06T00:00:00Z", or null. Pure. */
export const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z") : null);

/** Every version the list knows, newest first. Pure. */
export const allVersions = (s) => newestFirst(Object.keys(s.versions));

/** The hex of a GitHub asset digest ("sha256:<hex>"), or "" when the source gives none. Pure. */
export const digestHex = (digest) => (typeof digest === "string" && /^sha256:[0-9a-f]{64}$/i.test(digest) ? digest.slice(7).toLowerCase() : "");

/**
 * One version as the console list gives it: the zip's own address at the source, its size and the
 * digest the source published. files and unpacked stay 0: the server never opens the zip. Pure.
 */
export function versionView(s, version) {
  const e = s.versions[version];
  const archive = { url: e.asset.url, size: e.asset.size, sha256: digestHex(e.asset.digest), files: 0, unpacked: 0 };
  return { version, released: e.released || "", available: Boolean(e.upstream), ...(e.upstream ? {} : { reason: "upstream_gone" }), archive };
}

/** GET /api/firmware: `check` is the last check of the source named `name`, or null. Pure. */
export function listView(s, name, check) {
  return { source: { name, reachable: Boolean(check?.reachable), checked_at: iso(check?.at) }, versions: allVersions(s).map((v) => versionView(s, v)) };
}

/** Each version for the admin page: listed at the source now (available) or gone, its size and address there. Pure. */
export function adminVersions(s) {
  return allVersions(s).map((version) => {
    const v = versionView(s, version);
    return { version, released: v.released, available: v.available, reason: v.reason ?? null, size: v.archive.size, url: v.archive.url };
  });
}
