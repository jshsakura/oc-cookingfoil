/**
 * The library file browser behind GET /admin/api/library/browse: every file the
 * server hands out, in seven kinds, filtered, sorted and paged on the server.
 *
 *   base, update, dlc   game files of the shop scan (shop-cache files())
 *   patch, save         the patch and save listings
 *   homebrew            the homebrew apps
 *   other               files under the games folder the shop scan skipped
 *                       (anything not .nsp/.nsz/.xci/.xcz/.nro), found here
 *
 * Every item has the same fields, null when unknown:
 *   { name, kind, rel, size, mtime, ext, titleId, game, version, integrity, id, source, repo }
 * `game` is the name of the game a patch or save belongs to, so a list of them says which game each is for.
 * `id` (patch, save, homebrew), `source` ("github" | "manual") and `repo` (a followed GitHub repository)
 * are what the delete buttons need to name the item to its own remove endpoint.
 * `rel` is relative to the kind's own folder, never absolute. `mtime` is in
 * epoch seconds. `integrity` (ok | modified | damaged | unchecked) is only set
 * for game files.
 *
 * parseQuery() checks the query and throws a BadParam naming the parameter;
 * browse() is pure over the items it is given.
 */
import path from "path";
import FastGlob from "fast-glob";
import { GAME_FILE_RE } from "../helpers/file-send.js";
import { isReadme } from "../helpers/readme-name.js";

export const KINDS = ["base", "update", "dlc", "patch", "save", "homebrew", "other"];
export const FIELDS = ["name", "kind", "rel", "size", "mtime", "ext", "titleId", "game", "version", "integrity", "id", "source", "repo"];
export const INTEGRITY = ["ok", "modified", "damaged", "unchecked"];
const SORTS = ["name", "size", "mtime"];
export const PER_PAGE_DEFAULT = 50;
export const PER_PAGE_MAX = 500;
const PAGE_MAX = 1_000_000;
const Q_MAX = 200;
const EXT_RE = /^\.?[a-z0-9]{1,10}$/i;
const INT_RE = /^\d{1,16}$/;

export class BadParam extends Error {
  constructor(param, message) {
    super(message);
    this.code = "bad-param";
    this.param = param;
  }
}

const list = (raw) => String(raw).split(",").map((s) => s.trim()).filter(Boolean);
const one = (raw) => (Array.isArray(raw) ? raw[raw.length - 1] : raw);

function oneOf(param, raw, allowed) {
  const values = list(raw);
  const wrong = values.find((v) => !allowed.includes(v));
  if (wrong !== undefined || !values.length) throw new BadParam(param, `${param} 는 ${allowed.join(", ")} 중에서 고릅니다`);
  return [...new Set(values)];
}

function int(param, raw, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const s = String(raw).trim();
  const n = INT_RE.test(s) ? Number(s) : NaN;
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new BadParam(param, `${param} 는 ${min} 이상 ${max} 이하의 정수입니다`);
  return n;
}

function epochSeconds(param, raw) {
  const s = String(raw).trim();
  if (INT_RE.test(s)) return int(param, s);
  const ms = Date.parse(s);
  if (!Number.isFinite(ms)) throw new BadParam(param, `${param} 는 epoch 초나 ISO 날짜입니다`);
  return Math.floor(ms / 1000);
}

function flag(param, raw) {
  const s = String(raw).trim().toLowerCase();
  if (["1", "true", "yes"].includes(s)) return true;
  if (["0", "false", "no", ""].includes(s)) return false;
  throw new BadParam(param, `${param} 는 1 이나 0 입니다`);
}

/** The checked query, with defaults. Throws BadParam. Pure. */
export function parseQuery(query = {}) {
  const get = (k) => {
    const v = one(query[k]);
    return v === undefined || v === null || String(v).trim() === "" ? undefined : v;
  };
  const out = {
    kinds: ["base"], q: "", exts: null, minSize: null, maxSize: null, modifiedSince: null, integrity: null,
    sort: "name", order: "asc", page: 1, perPage: PER_PAGE_DEFAULT, fields: null, countsOnly: false,
  };
  if (get("kind") !== undefined) out.kinds = oneOf("kind", get("kind"), KINDS);
  if (get("q") !== undefined) {
    out.q = String(get("q")).trim();
    if (out.q.length > Q_MAX) throw new BadParam("q", `q 는 ${Q_MAX}자까지입니다`);
  }
  if (get("ext") !== undefined) {
    const exts = list(get("ext"));
    if (!exts.length || exts.some((e) => !EXT_RE.test(e))) throw new BadParam("ext", "ext 는 쉼표로 나눈 확장자입니다 (예: nsp,xci)");
    out.exts = new Set(exts.map((e) => (e.startsWith(".") ? e : `.${e}`).toLowerCase()));
  }
  if (get("minSize") !== undefined) out.minSize = int("minSize", get("minSize"));
  if (get("maxSize") !== undefined) out.maxSize = int("maxSize", get("maxSize"));
  if (out.minSize !== null && out.maxSize !== null && out.minSize > out.maxSize) throw new BadParam("maxSize", "maxSize 는 minSize 보다 작을 수 없습니다");
  if (get("modifiedSince") !== undefined) out.modifiedSince = epochSeconds("modifiedSince", get("modifiedSince"));
  if (get("integrity") !== undefined) out.integrity = new Set(oneOf("integrity", get("integrity"), INTEGRITY));
  if (get("sort") !== undefined) [out.sort] = oneOf("sort", get("sort"), SORTS);
  if (get("order") !== undefined) [out.order] = oneOf("order", get("order"), ["asc", "desc"]);
  if (get("page") !== undefined) out.page = int("page", get("page"), { min: 1, max: PAGE_MAX });
  if (get("perPage") !== undefined) out.perPage = int("perPage", get("perPage"), { min: 1, max: PER_PAGE_MAX });
  if (get("fields") !== undefined) out.fields = oneOf("fields", get("fields"), FIELDS);
  const countsOnly = get("counts_only") ?? get("countsOnly");
  if (countsOnly !== undefined) out.countsOnly = flag("counts_only", countsOnly);
  return out;
}

/** A path relative to its folder, with forward slashes; null for one that is absolute or climbs out. Pure. */
export function safeRel(rel) {
  if (typeof rel !== "string" || !rel) return null;
  const posix = rel.split(path.sep).join("/").replace(/\\/g, "/");
  if (posix.startsWith("/") || /^[a-z]:/i.test(posix)) return null;
  const norm = path.posix.normalize(posix);
  if (norm === ".." || norm.startsWith("../") || norm === ".") return null;
  return norm;
}

const extOf = (rel) => path.posix.extname(rel ?? "").toLowerCase() || null;

/** One item in the browser's shape: every field present, null when unknown. Pure. */
export function item(kind, { name, rel, size, mtime, titleId = null, game = null, version = null, integrity = null, id = null, source = null, repo = null }) {
  const safe = safeRel(rel);
  const time = mtime == null ? NaN : Number(mtime);
  const bytes = size == null || size === "" ? NaN : Number(size);
  return {
    name: String(name ?? (safe ? path.posix.basename(safe) : "")),
    kind,
    rel: safe,
    size: Number.isFinite(bytes) && bytes >= 0 ? bytes : null,
    mtime: Number.isFinite(time) && time > 0 ? Math.floor(time) : null,
    ext: extOf(safe),
    titleId: titleId ?? null,
    game: game ?? null,
    version: version ?? null,
    integrity: integrity ?? null,
    id: id ?? null,
    source: source ?? null,
    repo: repo ?? null,
  };
}

function matches(it, f) {
  if (f.q) {
    const q = f.q.toLowerCase();
    if (![it.name, it.rel, it.titleId, it.game].some((s) => (s ?? "").toLowerCase().includes(q))) return false;
  }
  if (f.exts && !f.exts.has(it.ext)) return false;
  if (f.minSize !== null && !(it.size >= f.minSize)) return false;
  if (f.maxSize !== null && !(it.size !== null && it.size <= f.maxSize)) return false;
  if (f.modifiedSince !== null && !(it.mtime !== null && it.mtime >= f.modifiedSince)) return false;
  if (f.integrity && !f.integrity.has(it.integrity)) return false;
  return true;
}

const collator = new Intl.Collator("ko", { numeric: true, sensitivity: "base" });

function comparator(sort, order) {
  const dir = order === "desc" ? -1 : 1;
  const tie = (a, b) => collator.compare(a.rel ?? "", b.rel ?? "");
  if (sort === "name") return (a, b) => dir * (collator.compare(a.name, b.name) || tie(a, b));
  // Unknown sizes and times go last whichever way the list runs.
  return (a, b) => {
    const x = a[sort], y = b[sort];
    if (x === null || y === null) return x === y ? tie(a, b) : x === null ? 1 : -1;
    return dir * (x - y) || tie(a, b);
  };
}

const pick = (it, fields) => (fields ? Object.fromEntries(fields.map((k) => [k, it[k]])) : it);

/**
 * One page of `items` (already in the browser's shape) for the parsed query.
 * `counts` are per kind with every filter but the kind applied, so a search
 * shows where its hits are. A page past the end is the last page. Pure.
 */
export function browse(items, f) {
  const counts = Object.fromEntries(KINDS.map((k) => [k, 0]));
  const hits = [];
  const wanted = new Set(f.kinds);
  for (const it of items) {
    if (!matches(it, f)) continue;
    counts[it.kind]++;
    if (wanted.has(it.kind)) hits.push(it);
  }
  if (f.countsOnly) return { counts, total: hits.length };
  hits.sort(comparator(f.sort, f.order));
  const pages = Math.max(1, Math.ceil(hits.length / f.perPage));
  const page = Math.min(f.page, pages);
  const start = (page - 1) * f.perPage;
  return {
    items: hits.slice(start, start + f.perPage).map((it) => pick(it, f.fields)),
    total: hits.length, page, perPage: f.perPage, pages, sort: f.sort, order: f.order, counts,
  };
}

const NRO_RE = /\.nro$/i;

/** A shop-cache file in the browser's shape; `verdictOf(rel)` is the file check's verdict or null. Pure. */
export function gameItem(f, verdictOf = () => null) {
  const kind = ["base", "update", "dlc"].includes(f.kind) ? f.kind : NRO_RE.test(f.rel) ? "homebrew" : "base";
  return item(kind, {
    name: f.name || path.posix.basename(String(f.rel)),
    rel: f.rel, size: f.size, mtime: f.mtime, titleId: f.titleId,
    version: f.version ?? null,
    integrity: kind === "homebrew" ? null : verdictOf(f.rel) ?? "unchecked",
  });
}

/**
 * Lists files under `root` that are not game files, cached for `ttlMs`.
 * Hidden files and folders are skipped, symlinks are never followed (a linked
 * file or folder is not listed at all), and folders in `ignore` (relative to
 * root) are left out. Concurrent calls share one scan.
 */
export function createOtherScanner({ root, ignore = [], ttlMs = 60_000, now = Date.now, max = 200_000 } = {}) {
  let cached = null;
  let at = 0;
  let inFlight = null;
  let generation = 0;
  const base = path.resolve(root);
  const ignorePatterns = ignore.map(safeRel).filter(Boolean).map((d) => `${d}/**`);

  async function scan() {
    const seen = generation;
    const entries = await FastGlob("**/*", {
      cwd: base, dot: false, onlyFiles: true, followSymbolicLinks: false, stats: true,
      ignore: ignorePatterns, suppressErrors: true, caseSensitiveMatch: false,
    });
    const out = [];
    for (const e of entries) {
      if (out.length >= max) break;
      if (GAME_FILE_RE.test(e.path) || e.dirent?.isSymbolicLink?.() || e.stats?.isSymbolicLink?.() || (e.stats && !e.stats.isFile())) continue;
      const rel = safeRel(e.path);
      if (!rel || !path.resolve(base, rel).startsWith(base + path.sep)) continue;
      // The server's own list of extra shop entries is configuration, not a stray file; a README.md at the top is the operator's notes.
      if (rel === "custom_entries.jsonc" || isReadme(rel)) continue;
      out.push({ rel, size: e.stats?.size ?? null, mtime: e.stats ? Math.floor(e.stats.mtimeMs / 1000) : null });
    }
    // A change that came in while walking leaves this result stale, but still better than nothing for peek.
    cached = out;
    at = seen === generation ? now() : -Infinity;
    return out;
  }

  const refresh = () => {
    inFlight ??= scan().finally(() => { inFlight = null; });
    return inFlight;
  };

  return {
    async list() {
      if (cached && now() - at < ttlMs) return cached;
      return refresh();
    },
    /**
     * What a request that must not wait can use: the last scan, even a stale
     * one (a fresh scan starts behind it), or null while the very first scan is
     * still walking the folder.
     */
    peek() {
      if (!cached || now() - at >= ttlMs) refresh().catch(() => {});
      return cached;
    },
    invalidate() {
      generation++;
      at = -Infinity;
    },
  };
}

/** Folders of `others` that sit inside `root`, relative to it (to leave out of the "other" scan). Pure. */
export function nestedDirs(root, others) {
  const base = path.resolve(root);
  return others.map((d) => path.relative(base, path.resolve(d))).filter((r) => r && !r.startsWith("..") && !path.isAbsolute(r));
}
