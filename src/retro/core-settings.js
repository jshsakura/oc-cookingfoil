/**
 * What the admin set for each RetroArch core, a row per core in the security database
 * (records kind "retro-core": { off?: true, source?: "repo" | "upload" }), and the GitHub
 * repository the "repo" source reads (kind "retro-core-repo", id "repo": { repo }).
 *
 *   off      the core leaves the console's base pack (its .nro and .info), the upkeep stops
 *            fetching it, and the games that start with it stay listed but can't be taken.
 *            Consoles that already have the core keep it: the pack only stops sending it.
 *   source   where the upkeep takes the core: "nightly" (the libretro buildbot, the default),
 *            "repo" (the latest release of the repository) or "upload" (the admin's own file,
 *            never fetched or replaced).
 */
import { recordStore } from "../db/security-stores.js";
import { REPO_RE } from "../meta/client-release.js";
import { CORE_RE } from "./system-cores.js";

export const SOURCES = ["nightly", "repo", "upload"];
export { REPO_RE };

let coreRows = null;
let repoRows = null;
let cores = null; // Map core → { off?, source? }
let offSet = null;
let repoName;

const coresTable = () => (coreRows ??= recordStore("retro-core"));
const repoTable = () => (repoRows ??= recordStore("retro-core-repo"));

function all() {
  cores ??= new Map(coresTable().load());
  return cores;
}

function write(core, change) {
  const { off, source } = { ...all().get(core), ...change };
  const row = { ...(off ? { off: true } : {}), ...(source && source !== "nightly" ? { source } : {}) };
  const next = new Map(all());
  if (Object.keys(row).length) next.set(core, row);
  else next.delete(core);
  coresTable().sync(next);
  cores = next;
  offSet = null;
}

/** The switched-off cores as a Set. */
export function off() {
  offSet ??= new Set([...all()].filter(([, r]) => r.off).map(([core]) => core));
  return offSet;
}

/** A key that changes whenever the off set does, for caches built from it. */
export const offKey = () => [...off()].sort().join(",");

/** Switches a core on or off. False for a malformed id. */
export function setEnabled(core, enabled) {
  if (!CORE_RE.test(String(core))) return false;
  write(core, { off: !enabled });
  return true;
}

/** Where the upkeep takes `core` from. */
export const sourceOf = (core) => all().get(core)?.source ?? "nightly";

/** Every core whose source is not nightly, as { core: source }. */
export const sources = () => Object.fromEntries([...all()].filter(([, r]) => r.source).map(([core, r]) => [core, r.source]));

/** Sets where the upkeep takes a core from. False for a malformed id or source. */
export function setSource(core, source) {
  if (!CORE_RE.test(String(core)) || !SOURCES.includes(source)) return false;
  write(core, { source });
  return true;
}

/** The "owner/name" repository the repo source reads, or null. */
export function repo() {
  if (repoName === undefined) repoName = repoTable().load().find(([id]) => id === "repo")?.[1]?.repo ?? null;
  return repoName;
}

/** Sets the repository; null or "" clears it. False when it is not owner/name. */
export function setRepo(name) {
  const value = name ? String(name).trim() : null;
  if (value !== null && !REPO_RE.test(value)) return false;
  repoTable().sync(value ? [["repo", { repo: value }]] : []);
  repoName = value;
  return true;
}
