/**
 * What a Switch game file is: { titleId, version, kind, baseTitleId,
 * titleIds }. Every reader asks here, so a file means the same everywhere.
 *
 * The answer comes from the file's cnmt, read in place with the keys
 * (nca-reader.js): every installable package carries one, whatever its name.
 * Without the keys or for a file whose cnmt does not read, the [TITLEID][vN]
 * in its name stands in, then a ticket's name. `source` says which.
 *
 * The library check (verify-queue.js) stores each file's identity as it goes
 * and hands it back through provideKnown(), so the library is read once and
 * again only for files that changed.
 */
import path from "path";
import { parseFromFilename } from "./filename-parser.js";
import { readCnmtIdentity } from "./cnmt-parse.js";
import { readCnmts } from "./nca-reader.js";
import { readPfs0Entries } from "./pfs0.js";

const KIND_RANK = { base: 0, update: 1, dlc: 2, delta: 3 };
const PFS0_RE = /\.(nsp|nsz)$/i;
const CACHE_MAX = 20_000;

/**
 * One identity from every cnmt a file carries: the game before its update,
 * with every title id listed in `titleIds`; null for none. Pure.
 */
export function pickIdentity(ids) {
  const found = ids.filter(Boolean);
  if (!found.length) return null;
  const [best] = [...found].sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind]);
  return { ...best, titleIds: [...new Set(found.map((i) => i.titleId))] };
}

/** The identity a file name carries ([TITLEID][vN]); null without one. Pure. */
export function identityFromName(rel) {
  const p = parseFromFilename(rel);
  if (!p.titleId) return null;
  return { titleId: p.titleId, version: p.version ?? null, kind: p.contentType, baseTitleId: p.groupTitleId };
}

/** The id a ticket's name carries (<title id><key generation>.tik), with its kind; null without one. Pure. */
export function identityFromTicket(names) {
  const tik = names.map((n) => /^([0-9a-f]{16})[0-9a-f]{16}\.tik$/i.exec(n)).find(Boolean);
  if (!tik) return null;
  const id = identityFromName(`[${tik[1].toUpperCase()}]`);
  return id && { ...id, version: null };
}

/**
 * True when the name carries a title id the content does not: a file named
 * for another game or edition. False when either side says nothing. Pure.
 */
export function nameDisagrees(rel, identity) {
  const named = identityFromName(path.basename(rel))?.titleId;
  if (!named || !identity) return false;
  return !(identity.titleIds ?? [identity.titleId]).includes(named);
}

/** The identity from a file's cnmt; null when the keys or the file cannot give it. */
export async function readIdentity(absPath) {
  return pickIdentity((await readCnmts(absPath)).map((x) => readCnmtIdentity(x.cnmt)));
}

/**
 * An identifier remembering each answer while the file's size and mtime hold.
 * `readIdentity(abs)` reads the cnmt, `readTicketNames(abs)` lists a package.
 */
export function createIdentifier({
  readIdentity: fromContent = readIdentity,
  readTicketNames = async (abs) => (await readPfs0Entries(abs))?.map((e) => e.name) ?? null,
  known = () => null,
} = {}) {
  const cache = new Map();

  /** { id, source: "cnmt" | "name" | "ticket" | null } for { abs, rel, size, mtimeMs }. */
  async function identify({ abs, rel, size, mtimeMs }) {
    const hit = cache.get(abs);
    if (hit && hit.size === size && hit.mtimeMs === mtimeMs) return hit;
    let id = known(abs, { size, mtimeMs }) ?? (await fromContent(abs).catch(() => null));
    let source = id ? "cnmt" : null;
    if (!id && (id = identityFromName(rel))) source = "name";
    if (!id && PFS0_RE.test(rel) && (id = identityFromTicket((await readTicketNames(abs).catch(() => null)) ?? []))) source = "ticket";
    const out = { size, mtimeMs, id, source };
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(abs, out);
    return out;
  }

  return { identify, forget: (abs) => cache.delete(abs) };
}

let knownFrom = () => null;

/** Where the shared identifier finds identities already read: (abs, { size, mtimeMs }) → identity | null. */
export const provideKnown = (fn) => { knownFrom = fn; };

export const { identify, forget } = createIdentifier({ known: (abs, st) => knownFrom(abs, st) });
