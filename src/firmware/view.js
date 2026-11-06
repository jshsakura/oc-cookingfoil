/**
 * How the kept firmware state (firmware/service.js) reads to a console and to the admin page.
 * All pure: `s` is the state ({ versions, cached, ... }), never changed here.
 */
import { newestFirst } from "./versions.js";

/** An epoch ms as "2026-11-06T00:00:00Z", or null. Pure. */
export const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z") : null);

/** Every version the state knows, listed or only cached, newest first. Pure. */
export const allVersions = (s) => newestFirst(new Set([...Object.keys(s.versions), ...Object.keys(s.cached)]));

/**
 * One version as the console list gives it. A cached zip is available and its own numbers are
 * shown; otherwise the listed asset, unavailable when its zip was bad or the source dropped it. Pure.
 */
export function versionView(s, version) {
  const e = s.versions[version];
  const c = s.cached[version];
  const url = `/api/firmware/${version}/download`;
  if (c) return { version, released: e?.released || c.released || "", available: true, archive: { url, size: c.size, sha256: c.sha256, files: c.files, unpacked: c.unpacked } };
  const reason = e.bad ? "bad_archive" : e.upstream ? null : "upstream_gone";
  const archive = { url, size: e.asset?.size ?? 0, sha256: "", files: e.files || 0, unpacked: e.unpacked || 0 };
  return { version, released: e.released || "", available: !reason, ...(reason ? { reason } : {}), archive };
}

/** GET /api/firmware: `check` is the last check of the source named `name`, or null. Pure. */
export function listView(s, name, check) {
  return { source: { name, reachable: Boolean(check?.reachable), checked_at: iso(check?.at) }, versions: allVersions(s).map((v) => versionView(s, v)) };
}

/** Each version for the admin page: listed upstream, cached, available and why not, and what a bad zip failed. Pure. */
export function adminVersions(s) {
  return allVersions(s).map((version) => {
    const v = versionView(s, version);
    const e = s.versions[version];
    return { version, upstream: Boolean(e?.upstream), cached: Boolean(s.cached[version]), available: v.available, reason: v.reason ?? null, size: v.archive.size, files: v.archive.files, ...(e?.bad ? { problem: e.bad.message } : {}) };
  });
}
