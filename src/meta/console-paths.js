/**
 * What a path the console writes on its SD card may look like. Every path the
 * server hands a console to create (a homebrew app's files, its install path
 * and folder, a zip's entries, a patch's files) goes through pathProblem: the
 * card's file system cannot create some names (a Korean file name failed at
 * the final rename), so only printable ASCII is allowed, without the
 * characters FAT rejects.
 *
 *   letters    0x20-0x7E only; none of \ : * ? " < > |
 *   segments   not empty, no leading or trailing space or dot (".", ".." included),
 *              at most MAX_SEGMENT bytes
 *   whole      at most MAX_PATH bytes, "/"-separated, relative
 *
 * A space inside a name is fine ("Battle wild.ogg" writes normally).
 */
export const MAX_SEGMENT = 255;
export const MAX_PATH = 768;
const NOT_ASCII_RE = /[^\x20-\x7e]/;
const FORBIDDEN_RE = /[\\:*?"<>|]/;

/** Why the console cannot create `p`, in Korean for the admin page, or null when it can. Pure. */
export function pathProblem(p) {
  const s = String(p ?? "");
  if (!s) return "경로가 비어 있습니다";
  if (NOT_ASCII_RE.test(s)) return "영문, 숫자, 기호(ASCII)가 아닌 글자가 있습니다";
  if (FORBIDDEN_RE.test(s)) return "\\ : * ? \" < > | 는 쓸 수 없습니다";
  if (s.startsWith("/")) return "/ 로 시작하면 안 됩니다";
  if (s.length > MAX_PATH) return `전체 경로가 ${MAX_PATH}자를 넘습니다`;
  for (const seg of s.split("/")) {
    if (!seg) return "빈 폴더 이름이 있습니다";
    if (/^[ .]|[ .]$/.test(seg)) return `"${seg}" 은 공백이나 점으로 시작하거나 끝납니다`;
    if (seg.length > MAX_SEGMENT) return `이름 하나가 ${MAX_SEGMENT}자를 넘습니다`;
  }
  return null;
}

/** [{ path, reason }] for every path the console cannot create. Pure. */
export function pathProblems(paths) {
  return paths.flatMap((p) => {
    const reason = pathProblem(p);
    return reason ? [{ path: p, reason }] : [];
  });
}

/** "a/b.md (이유), …" for a log line or an error message, the first few only. Pure. */
export function describeProblems(problems, max = 5) {
  const shown = problems.slice(0, max).map((x) => `${x.path} (${x.reason})`).join(", ");
  return problems.length > max ? `${shown} 외 ${problems.length - max}개` : shown;
}
