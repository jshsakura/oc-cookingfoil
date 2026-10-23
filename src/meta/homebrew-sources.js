/**
 * The GitHub repositories the server follows for homebrew, as the admin keeps
 * them from the admin page: ${COOK_DATA_DIR}/homebrew/sources.json.
 *
 *   { version: 1, sources: [{ repo: "owner/name", asset: "pattern" | null, addedAt }] }
 *
 * `asset` picks which release file to use when a release carries several
 * (a glob such as "ftpd.nro" or "*-classic.nro"); null lets the server choose.
 *
 * COOK_HOMEBREW_REPOS only seeds the list: it is read when the file does not
 * exist yet, and ignored once the admin has a list.
 */
import fs from "fs";
import path from "path";
import { dataDir, homebrewRepos } from "../helpers/envs.js";
import { parseRepo } from "./homebrew.js";
import debug from "../debug.js";
import { metaText } from "./meta-messages.js";

const FILE = path.join(dataDir, "homebrew", "sources.json");
const MAX_SOURCES = 200;
const PATTERN_RE = /^[A-Za-z0-9_.*?\- ]{1,100}$/;

/** A refusal with its meta-messages.js key as `code` and its English message. */
export class SourceError extends Error {
  constructor(code, vars = {}) {
    super(metaText("en", code, vars));
    this.code = code;
    this.vars = vars;
  }
}

let sources = null;

function load() {
  try {
    const saved = JSON.parse(fs.readFileSync(FILE, "utf8"));
    return (saved.sources ?? []).filter((s) => parseRepo(s?.repo) === s.repo).map((s) => ({ repo: s.repo, asset: s.asset ?? null, addedAt: s.addedAt ?? null }));
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  const seeded = [];
  for (const raw of homebrewRepos) {
    const repo = parseRepo(raw);
    if (!repo) debug.error("homebrew: ignoring %s, not a GitHub repository", raw);
    else if (!seeded.some((s) => s.repo.toLowerCase() === repo.toLowerCase())) seeded.push({ repo, asset: null, addedAt: Date.now() });
  }
  if (seeded.length) persist(seeded);
  return seeded;
}

function persist(next) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(`${FILE}.tmp`, `${JSON.stringify({ version: 1, sources: next }, null, 1)}\n`);
  fs.renameSync(`${FILE}.tmp`, FILE);
  sources = next;
}

export function list() {
  sources ??= load();
  return sources.map((s) => ({ ...s }));
}

const find = (repo) => list().find((s) => s.repo.toLowerCase() === repo.toLowerCase());

/** A release-file pattern, or null for "let the server choose". Throws on a bad one. */
export function cleanPattern(raw) {
  const p = String(raw ?? "").trim();
  if (!p) return null;
  if (!PATTERN_RE.test(p) || !/\.(nro|zip)$/i.test(p)) throw new SourceError("sources.badPattern");
  return p;
}

/** Adds a repository (owner/name or its GitHub address). Returns the stored entry. */
export function add(raw, asset = null) {
  const repo = parseRepo(raw);
  if (!repo) throw new SourceError("sources.badRepo");
  const existing = find(repo);
  if (existing) return existing;
  if (list().length >= MAX_SOURCES) throw new SourceError("sources.tooMany", { max: MAX_SOURCES });
  const entry = { repo, asset: cleanPattern(asset), addedAt: Date.now() };
  persist([...list(), entry]);
  return entry;
}

/** @returns {boolean} whether it was listed */
export function remove(repo) {
  const existing = find(String(repo ?? ""));
  if (!existing) return false;
  persist(list().filter((s) => s !== existing && s.repo !== existing.repo));
  return true;
}

/** @returns {boolean} whether it is listed */
export function setAsset(repo, asset) {
  const existing = find(String(repo ?? ""));
  if (!existing) return false;
  const pattern = cleanPattern(asset);
  persist(list().map((s) => (s.repo === existing.repo ? { ...s, asset: pattern } : s)));
  return true;
}
