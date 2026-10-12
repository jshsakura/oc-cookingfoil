/**
 * One HTTP byte range (RFC 9110), for resuming a download:
 *
 *   bytes=0-99   bytes=100-   bytes=-100
 *
 * → [start, end] inclusive, null to send the whole body (no Range, several
 * ranges, a malformed one, or an If-Range that no longer matches the ETag), or
 * "unsatisfiable" when it starts past the end. Pure.
 */
export function parseRange(headers, total, etag) {
  const raw = headers?.range;
  if (typeof raw !== "string") return null;
  const ifRange = headers["if-range"];
  if (ifRange !== undefined && ifRange !== `"${etag}"`) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(raw.trim());
  if (!m || (m[1] === "" && m[2] === "")) return null;
  let start, end;
  if (m[1] === "") {
    const suffix = Number(m[2]);
    if (suffix === 0) return "unsatisfiable";
    start = Math.max(total - suffix, 0);
    end = total - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? total - 1 : Math.min(Number(m[2]), total - 1);
  }
  if (start >= total || end < start) return "unsatisfiable";
  return [start, end];
}
