/**
 * The patch map of one game file for one target generation: every byte range
 * that differs once the file is lowered to that generation, as
 * [{ offset, bytes }], sorted and not overlapping. The file itself is only
 * read; serving lays the map over it (patch-stream.js), so the size never
 * changes and nothing is written anywhere.
 *
 * What changes, for NSP, NSZ, XCI and XCZ alike:
 *   - each NCA or NCZ header above the target generation (header.js); an NCZ
 *     starts with its NCA's header area unchanged, so the same bytes are its header
 *   - each ticket whose title key belongs to such an NCA (ticket.js), and the
 *     names of that ticket and its certificate, whose last two hex digits are
 *     the rights ID's generation byte (same length, written in place)
 *   - the RequiredSystemVersion of each meta NCA above the target's firmware (cnmt.js)
 *
 * The server must hold the keys of every generation the file uses, so the
 * rule a console sees is simple: keys at least as new as the game, or a 409
 * naming the gap. XCI and XCZ partitions hash parts of their entries and their
 * own tables; a change there is refused rather than leaving a hash that lies.
 */
import fs from "fs/promises";
import { readPfs0Entries } from "../pfs0.js";
import { readXciSecureEntries } from "../hfs0.js";
import { HEADER_BYTES, decryptHeader, encryptHeader, headerGeneration, maxGeneration } from "../nca-crypto.js";
import { firmwareOf, keyGenerationByte } from "./generations.js";
import { lowerHeader, rightsIdOf } from "./header.js";
import { lowerTicket, ticketRightsId } from "./ticket.js";
import { lowerRequiredSystem } from "./cnmt.js";
import { RewrapError } from "./refusals.js";

const XCI_RE = /\.xc[iz]$/i;
const NCA_RE = /\.(nca|ncz)$/i;
const META_NCA_RE = /\.cnmt\.nca$/i;
const CONTENT_META = 1;
const MAX_META_NCA = 1 << 20;
const MAX_TICKET = 0x1000;
// Changed runs closer than this are sent as one patch.
const MERGE_GAP = 32;

const unsupported = (detail) => new RewrapError("unsupported", {}, detail);

/** Patches turning `before` into `after` (same length), placed at file offset `at`. Pure. */
export function diffPatches(before, after, at) {
  const out = [];
  let i = 0;
  while (i < before.length) {
    if (before[i] === after[i]) { i++; continue; }
    let end = i + 1;
    for (let j = end; j < before.length && j - end < MERGE_GAP; j++) if (before[j] !== after[j]) end = j + 1;
    out.push({ offset: at + i, bytes: Buffer.from(after.subarray(i, end)) });
    i = end;
  }
  return out;
}

/** The container's entries and whether it is a gamecard image; null when it is neither kind. */
async function readContainer(absPath) {
  const xci = XCI_RE.test(absPath);
  const entries = xci ? await readXciSecureEntries(absPath) : await readPfs0Entries(absPath);
  return entries ? { xci, entries } : null;
}

async function readEntry(handle, entry, length = entry.size) {
  const buf = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buf, 0, length, entry.offset);
  if (bytesRead !== length) throw unsupported(`entry ${entry.name} is truncated`);
  return buf;
}

/** The decrypted header of every NCA and NCZ, with the bytes the file holds. */
async function readHeaders(handle, entries, headerKey) {
  const out = [];
  for (const entry of entries.filter((e) => NCA_RE.test(e.name))) {
    if (entry.size < HEADER_BYTES) throw unsupported(`entry ${entry.name} is smaller than an NCA header`);
    const raw = await readEntry(handle, entry, HEADER_BYTES);
    const plain = decryptHeader(raw, headerKey);
    const magic = plain.toString("ascii", 0x200, 0x204);
    if (magic !== "NCA3" && magic !== "NCA2") throw unsupported(`entry ${entry.name} does not decrypt to an NCA header`);
    out.push({ entry, raw, plain, gen: headerGeneration(plain) });
  }
  if (!out.length) throw unsupported("no NCA in the container");
  return out;
}

/** The generation every key must reach, checked against what the server holds. */
function checkKeys(headers, keys) {
  const have = maxGeneration(keys);
  if (have === null) throw new RewrapError("noKeys");
  const need = Math.max(...headers.map((h) => h.gen));
  if (need > have) {
    // The owner's wording names only the prod.keys version to get: the first firmware of the generation needed.
    throw new RewrapError("keysTooOld", { version: firmwareOf(need) }, `keys reach generation ${have}, the file needs ${need}`);
  }
}

/** The patches of one NCA: its header, and for a meta NCA its section. Records a lowered rights ID in `rights`. */
async function ncaPatches(handle, { entry, raw, plain, gen }, { target, keys, headerKey }, rights) {
  const lowered = lowerHeader(plain, target.generation, keys);
  const rightsId = rightsIdOf(plain);
  if (rightsId && lowered !== plain) rights.set(rightsId, gen);
  let header = lowered;
  const patches = [];
  if (plain[0x205] === CONTENT_META) {
    if (!META_NCA_RE.test(entry.name)) throw unsupported(`meta NCA ${entry.name} is compressed or misnamed`);
    if (entry.size > MAX_META_NCA) throw unsupported(`meta NCA ${entry.name} is too large`);
    const nca = await readEntry(handle, entry);
    const changed = lowerRequiredSystem({ original: plain, lowered, nca, keys }, target.systemVersion);
    if (changed) {
      header = changed.header;
      const { at, bytes } = changed.section;
      patches.push(...diffPatches(nca.subarray(at, at + bytes.length), bytes, entry.offset + at));
    }
  }
  if (header !== plain) patches.push(...diffPatches(raw, encryptHeader(header, headerKey), entry.offset));
  return patches;
}

/** The patches of the tickets of each lowered rights ID, and of their entry names. */
async function ticketPatches(handle, container, { target, keys }, rights) {
  if (rights.size && container.xci) throw unsupported("renaming a ticket inside a gamecard partition would break its hash");
  const patches = [];
  const hex = keyGenerationByte(target.generation).toString(16).padStart(2, "0");
  for (const [rightsId, gen] of rights) {
    const named = container.entries.filter((e) => e.name.toLowerCase().startsWith(rightsId) && /\.(tik|cert)$/i.test(e.name));
    const tik = named.find((e) => /\.tik$/i.test(e.name));
    if (!tik || tik.size > MAX_TICKET) throw unsupported("a titlekey NCA has no ticket beside it");
    const ticket = await readEntry(handle, tik);
    if (ticketRightsId(ticket) !== rightsId) throw unsupported("the ticket's rights ID differs from its name");
    patches.push(...diffPatches(ticket, lowerTicket(ticket, gen, target.generation, keys), tik.offset));
    for (const e of named) {
      const old = e.name.slice(30, 32);
      // Written in the case the rest of the name uses.
      const fresh = /[A-F]/.test(e.name.slice(0, 32)) ? hex.toUpperCase() : hex;
      if (fresh !== old) patches.push({ offset: e.nameAt + 30, bytes: Buffer.from(fresh, "ascii") });
    }
  }
  return patches;
}

/** Refuses a patch inside the hashed head of a gamecard partition entry. */
function checkHashedRanges(container, patches) {
  if (!container.xci) return;
  for (const e of container.entries) {
    const hashedEnd = e.offset + (e.hashedSize ?? 0);
    if (patches.some((p) => p.offset < hashedEnd && p.offset + p.bytes.length > e.offset)) {
      throw unsupported(`a change falls inside the hashed part of ${e.name}`);
    }
  }
}

/**
 * The patch map of `absPath` lowered to `target` (generations.js parseTarget:
 * { generation, systemVersion }): a frozen, sorted list, empty when nothing
 * needs to change. `keys` is prod-keys.js loadKeys().
 * Throws RewrapError for a refusal; I/O errors pass through.
 */
export async function buildPatchMap(absPath, target, keys) {
  const headerKey = keys?.get("header_key")?.length === 64 ? Buffer.from(keys.get("header_key"), "hex") : null;
  if (!headerKey) throw new RewrapError("noKeys");
  const container = await readContainer(absPath);
  if (!container) throw unsupported("not a PFS0 or gamecard image");
  const handle = await fs.open(absPath, "r");
  try {
    const headers = await readHeaders(handle, container.entries, headerKey);
    checkKeys(headers, keys);
    const ctx = { target, keys, headerKey };
    const rights = new Map(); // rights ID → the generation its NCAs had
    const patches = [];
    for (const h of headers) patches.push(...(await ncaPatches(handle, h, ctx, rights)));
    patches.push(...(await ticketPatches(handle, container, ctx, rights)));
    checkHashedRanges(container, patches);
    patches.sort((a, b) => a.offset - b.offset);
    return Object.freeze(patches.map((p) => Object.freeze(p)));
  } finally {
    await handle.close();
  }
}
