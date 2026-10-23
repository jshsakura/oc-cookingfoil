/**
 * What a path the console writes on its SD card may look like. Every path the
 * server hands a console to create (a homebrew app's files, its install path
 * and folder, a zip's entries, a patch's files) goes through pathProblem: the
 * card's file system cannot create some names (a Korean file name failed at
 * the final rename), so only printable ASCII is allowed, without the
 * characters FAT rejects.
 *
 *   letters    0x20-0x7E only; none of \ : * ? " < > |
 *   segments   not empty, not "." or "..", no leading space, no trailing space or
 *              dot (FAT drops those), at most MAX_SEGMENT bytes. A leading dot
 *              is fine: the client's own ".cf-<hash>.part" files are named so
 *   whole      at most MAX_PATH bytes, "/"-separated, relative
 *
 * A space inside a name is fine ("Battle wild.ogg" writes normally).
 */
import { metaText } from "./meta-messages.js";

export const MAX_SEGMENT = 255;
export const MAX_PATH = 768;
const NOT_ASCII_RE = /[^\x20-\x7e]/;
const FORBIDDEN_RE = /[\\:*?"<>|]/;

/** Why the console cannot create `p` as { code, vars } (a meta-messages.js key), or null when it can. Pure. */
export function pathProblemCode(p) {
  const s = String(p ?? "");
  if (!s) return { code: "path.empty", vars: {} };
  if (NOT_ASCII_RE.test(s)) return { code: "path.notAscii", vars: {} };
  if (FORBIDDEN_RE.test(s)) return { code: "path.forbidden", vars: {} };
  if (s.startsWith("/")) return { code: "path.absolute", vars: {} };
  if (s.length > MAX_PATH) return { code: "path.tooLong", vars: { max: MAX_PATH } };
  for (const seg of s.split("/")) {
    if (!seg) return { code: "path.emptySegment", vars: {} };
    if (seg === "." || seg === "..") return { code: "path.dotSegment", vars: { name: seg } };
    if (/^ |[ .]$/.test(seg)) return { code: "path.edgeSpace", vars: { name: seg } };
    if (seg.length > MAX_SEGMENT) return { code: "path.segmentTooLong", vars: { max: MAX_SEGMENT } };
  }
  return null;
}

/** Why the console cannot create `p`, in English, or null when it can. Pure. */
export function pathProblem(p) {
  const why = pathProblemCode(p);
  return why && metaText("en", why.code, why.vars);
}

/**
 * [{ path, reason, code, vars }] for every path the console cannot create, including two
 * that differ only by case (FAT treats them as one file). `reason` is English; `code` and
 * `vars` say it in another language (describeProblems). Pure.
 */
export function pathProblems(paths) {
  const seen = new Map();
  const problem = (p, code, vars) => [{ path: p, reason: metaText("en", code, vars), code, vars }];
  return paths.flatMap((p) => {
    const why = pathProblemCode(p);
    if (why) return problem(p, why.code, why.vars);
    const folded = String(p).toLowerCase();
    const other = seen.get(folded);
    seen.set(folded, p);
    return other !== undefined && other !== p ? problem(p, "path.caseClash", { other }) : [];
  });
}

/** "a/b.md (why), …" in `lang` for a log line or an error message, the first few only. Pure. */
export function describeProblems(problems, max = 5, lang = "en") {
  const reasonOf = (x) => (x.code ? metaText(lang, x.code, x.vars) : x.reason);
  const shown = problems.slice(0, max).map((x) => `${x.path} (${reasonOf(x)})`).join(", ");
  return problems.length > max ? metaText(lang, "path.andMore", { shown, n: problems.length - max }) : shown;
}
