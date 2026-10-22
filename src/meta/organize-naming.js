/**
 * The names the drop box (library-organize.js) gives game files and new game
 * folders, from the plan's naming rule:
 *
 *   <name> [TITLEID][vN].ext      the file
 *   <name>                        a new game's folder
 *
 * The name is the first usable one of: the admin's name for the title, titledb's
 * (in the first language of the priority it has), the NACP inside the file, and
 * the file's own name with its tags and site prefixes taken off. A candidate
 * with a replacement character (U+FFFD) or a control character is broken text
 * (an unreadable or compressed NACP, a mangled download) and is passed over.
 * What is left is made safe for any filesystem: no reserved characters, no
 * leading or trailing spaces or dots, at most NAME_MAX_BYTES of UTF-8. Case is
 * kept as it is. Everything here is pure.
 */
import path from "path";

export const NAME_MAX_BYTES = 200;
// How many numbered names (" (2)" … ) a taken file name tries before the file is held.
const FREE_TRIES = 9;

const BROKEN_RE = /[\uFFFD\x00-\x1f\x7f-\x9f]/;
// Bidi controls turn the " [ID][vN].ext" after a name around on screen, and invisible
// marks make two names that look the same; both come out. ZWJ and ZWNJ stay (emoji, scripts).
const INVISIBLE_RE = /[\u061C\u200B\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;
const RESERVED_RE = /[\\/*?"<>|]/g;
const COLON_RE = /\s*[:：꞉]\s*/g;
// Device names Windows (and so an SMB share) will not take as a file or folder name,
// alone or before any extension ("aux.txt").
const DEVICE_RE = /^(con|prn|aux|nul|com[0-9\u00B9\u00B2\u00B3]|lpt[0-9\u00B9\u00B2\u00B3]|conin\$|conout\$)(\s*\..*)?$/i;
const DOMAIN = String.raw`(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|me|to|cc|ru|xyz|info|co|kr|site|club|online|top|vip|biz|tv|in|us|eu)`;
const DOMAIN_ONLY_RE = new RegExp(`^${DOMAIN}$`, "i");
const LEAD_DOMAIN_RE = new RegExp(`^\\s*${DOMAIN}\\s*[-_~|]+\\s*`, "i");
const TRAIL_DOMAIN_RE = new RegExp(`\\s*[-_~|]+\\s*${DOMAIN}\\s*$`, "i");
// Bracketed groups in a release name are tags ([ID], [v0], [US], [UPD]); parentheses are tags only when they say one of these.
const BRACKET_RE = /\[[^\]]*\]|\{[^}]*\}|【[^】]*】/g;
const PAREN_RE = /\(([^)]*)\)/g;
const NOISE_TAG_RE = /^(nsp|nsz|xci|xcz|nsw|switch|base|upd|update|dlc|eshop|usa?|eur?|jpn?|kor?|kr|asia|world|global|multi\d*|[a-z]{2}(?:\s*[,+]\s*[a-z]{2})+)$/i;
const EXT_RE = /\.[a-z0-9]{2,4}$/i;
// The " (1)" a browser adds to a second download of the same name.
const DUP_SUFFIX_RE = /\s*\([1-9]\)\s*$/;
// A scene release name: words joined by dots and no spaces (Super.Mario.Odyssey.NSW-BigBlueBox).
const SCENE_DOT_RE = /[\p{L}\p{N}]\.[\p{L}\p{N}]/u;
// Words a DLC file name carries that say nothing of what the DLC is.
const FILLER_WORDS = new Set(["dlc", "aoc", "add", "on", "addon", "upd", "update", "patch", "content", "contents"]);

/** Cuts `text` to at most `max` bytes of UTF-8 without splitting a character. */
function cutBytes(text, max) {
  if (Buffer.byteLength(text) <= max) return text;
  let out = "";
  let bytes = 0;
  for (const ch of text) {
    bytes += Buffer.byteLength(ch);
    if (bytes > max) break;
    out += ch;
  }
  return out;
}

const trimEnds = (s) => s.replace(/^[\s.]+|[\s.]+$/g, "");

/** `raw` made safe for a file or folder name, or null when it is empty or broken text. */
export function cleanName(raw) {
  if (typeof raw !== "string" || BROKEN_RE.test(raw)) return null;
  const safe = trimEnds(raw.normalize("NFC").replace(INVISIBLE_RE, "").replace(COLON_RE, " - ").replace(RESERVED_RE, "").replace(/\s+/g, " "));
  const name = trimEnds(cutBytes(safe, NAME_MAX_BYTES));
  return name && !DEVICE_RE.test(name) ? name : null;
}

/** A game's name from a file name: its tags, site prefixes and extension taken off; null when nothing is left. */
export function nameFromFile(fileName) {
  let stem = path.posix.basename(String(fileName ?? "").replace(/\\/g, "/")).replace(EXT_RE, "");
  if (BROKEN_RE.test(stem)) return null;
  stem = stem
    .replace(BRACKET_RE, " ")
    .replace(PAREN_RE, (whole, inner) => (DOMAIN_ONLY_RE.test(inner.trim()) || NOISE_TAG_RE.test(inner.trim()) ? " " : whole))
    .replace(LEAD_DOMAIN_RE, "")
    .replace(TRAIL_DOMAIN_RE, "")
    .replace(DUP_SUFFIX_RE, "")
    .trim();
  if (DOMAIN_ONLY_RE.test(stem)) return null;
  if (!/\s/.test(stem) && SCENE_DOT_RE.test(stem)) stem = stem.replace(/\./g, " ");
  return cleanName(stem);
}

/** True for a name that says nothing of what it is: only numbers and words like dlc, aoc, update, or one letter. Pure. */
export function isMeaningless(name) {
  const words = String(name ?? "").toLowerCase().split(/[^\p{L}]+/u).filter((w) => w && !FILLER_WORDS.has(w));
  return words.join("").length < 2;
}

/** The first candidate that makes a usable name, cleaned; null when none does. */
export function firstName(candidates) {
  for (const c of candidates) {
    const name = cleanName(c);
    if (name) return name;
  }
  return null;
}

/** From { ko, en, ja, zh }, the name in the first language of `priority` ("en-US" counts as en) it has, then any other. */
export function nameIn(names, priority) {
  if (!names || typeof names !== "object") return null;
  const langs = [...new Set((priority ?? []).map((l) => String(l).split("-")[0].toLowerCase()))];
  return firstName([...langs.map((l) => names[l]), ...Object.values(names)]);
}

/** `<name> [TITLEID][vN].ext`, with ` (n)` after the name from the second on. */
export function gameFileName(name, { titleId, version }, ext, n = 1) {
  return `${name}${n > 1 ? ` (${n})` : ""} [${titleId}][v${version}]${ext}`;
}

/** `dir/<file name>`, numbered past the names `isTaken(rel)` says are in use; null when a few numbers are all taken. */
export function freeFileName(dir, name, id, ext, isTaken) {
  for (let n = 1; n <= FREE_TRIES; n++) {
    const rel = `${dir}/${gameFileName(name, id, ext, n)}`;
    if (!isTaken(rel)) return rel;
  }
  return null;
}
