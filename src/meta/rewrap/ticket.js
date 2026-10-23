/**
 * Rewraps the title key in a ticket (.tik) for an older master key generation.
 *
 * Reference: https://switchbrew.org/wiki/Ticket
 *   0x00  u32 LE signature type, then the signature and its padding (SIGNATURES)
 *   body:
 *     0x040  title key block 0x100; a common ticket keeps the title key, AES-128-ECB
 *            with titlekek_{generation}, in its first 0x10 bytes
 *     0x141  title key type: 0 common, 1 personalized (RSA-sealed to one console)
 *     0x145  master key revision, the key generation byte
 *     0x160  rights ID; its last byte is the key generation byte too
 *
 * The signature no longer matches afterwards, as with the NCA header: a
 * console installs the result only with signature patches.
 *
 * Pure: returns a new buffer.
 */
import { ecbDecrypt, ecbEncrypt, titleKek } from "../nca-crypto.js";
import { firmwareOf, keyGenerationByte } from "./generations.js";
import { RewrapError } from "./refusals.js";

// Signature type → bytes of signature plus padding before the body.
const SIGNATURES = new Map([
  [0x010000, 0x200 + 0x3c], [0x010003, 0x200 + 0x3c], // RSA-4096
  [0x010001, 0x100 + 0x3c], [0x010004, 0x100 + 0x3c], // RSA-2048
  [0x010002, 0x3c + 0x40], [0x010005, 0x3c + 0x40], // ECDSA
  [0x010006, 0x14 + 0x28], // HMAC
]);
const BODY_BYTES = 0x180;
const TITLE_KEY = 0x40;
const KEY_TYPE = 0x141;
const KEY_REVISION = 0x145;
const RIGHTS_ID = 0x160;
const COMMON = 0;

/** Where the ticket body starts; null when the buffer is no ticket we know. Pure. */
export function bodyOffset(ticket) {
  if (ticket.length < 4) return null;
  const skip = SIGNATURES.get(ticket.readUInt32LE(0));
  if (skip === undefined || ticket.length < 4 + skip + BODY_BYTES) return null;
  return 4 + skip;
}

/** The ticket's rights ID as 32 lower-case hex digits; null when it is no ticket. Pure. */
export function ticketRightsId(ticket) {
  const body = bodyOffset(ticket);
  return body === null ? null : ticket.subarray(body + RIGHTS_ID, body + RIGHTS_ID + 0x10).toString("hex");
}

/**
 * The ticket with its title key moved from generation `gen` to `target`, and
 * its master key revision and rights ID byte set to match. Throws RewrapError.
 */
export function lowerTicket(ticket, gen, target, keys) {
  const body = bodyOffset(ticket);
  if (body === null) throw new RewrapError("unsupported", {}, "unknown ticket signature type");
  if (ticket[body + KEY_TYPE] !== COMMON) throw new RewrapError("personalTicket");
  const [from, to] = [gen, target].map((g) => {
    const kek = titleKek(keys, g);
    if (!kek) throw new RewrapError("keyMissing", { gen: g, firmware: firmwareOf(g) }, `no titlekek for generation ${g}`);
    return kek;
  });
  const out = Buffer.from(ticket);
  const at = body + TITLE_KEY;
  ecbEncrypt(to, ecbDecrypt(from, ticket.subarray(at, at + 0x10))).copy(out, at);
  out[body + KEY_REVISION] = keyGenerationByte(target);
  out[body + RIGHTS_ID + 0x0f] = keyGenerationByte(target);
  return out;
}
