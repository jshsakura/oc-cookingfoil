/**
 * Whether a package's ticket carries a real signature, read from the package itself: the ticket
 * (<rights id>.tik) is checked against the XS certificate in its .cert file, and that certificate
 * against the CA certificate next to it.
 *
 *   ticketSigned(tik, cert)   true | false. Pure.
 *
 * A console imports a ticket only when its signature holds, unless it runs signature patches. A
 * package whose ticket was made up (the usual "fake ticket" of a repacked file) has a signature that
 * does not verify, and that is what this tells. The root certificate is not in the package, so the CA
 * certificate is taken as found: a forged chain would pass here and still fail on the console.
 *
 * Record layout (ticket and certificates alike): u32 BE signature type, the signature, padding to a
 * 0x40 boundary, then the signed body. A certificate body is issuer (0x40), u32 BE key type, name
 * (0x40), u32, then the public key. A ticket body starts with its issuer, "Root-CA00000003-XS00000020",
 * whose last part names the certificate that signed it.
 */
import { createPublicKey, verify } from "node:crypto";

// signature type -> signature size; all three hash with SHA-256 (RSA in PKCS#1 v1.5).
const SIG_SIZE = { 0x10003: 0x200, 0x10004: 0x100, 0x10005: 0x3c };
// key type -> [modulus size, total key field size]; 2 is ECC, which signs nothing a ticket needs.
const KEY_SIZE = { 0: [0x200, 0x238], 1: [0x100, 0x138], 2: [0, 0x78] };
const NAME_BYTES = 0x40;
const CERT_HEAD = NAME_BYTES + 4 + NAME_BYTES + 4;
const MAX_CERTS = 8;

const align = (n) => Math.ceil(n / 0x40) * 0x40;
const text = (buf) => buf.toString("latin1").split("\0")[0];

/** { type, sig, body, bodyAt } of the record at `at`, or null when it does not fit. */
function recordAt(buf, at) {
  if (buf.length < at + 4) return null;
  const type = buf.readUInt32BE(at);
  const size = SIG_SIZE[type];
  if (!size) return null;
  const bodyAt = at + align(4 + size);
  if (buf.length < bodyAt + NAME_BYTES) return null;
  return { type, sig: buf.subarray(at + 4, at + 4 + size), bodyAt };
}

/** The certificates of a .cert file: [{ issuer, name, key, sig, type, signed }]; [] when it does not parse. */
export function readCerts(buf) {
  const out = [];
  let at = 0;
  while (at < buf.length && out.length < MAX_CERTS) {
    const r = recordAt(buf, at);
    if (!r || buf.length < r.bodyAt + CERT_HEAD) return out;
    const keyType = buf.readUInt32BE(r.bodyAt + NAME_BYTES);
    const sizes = KEY_SIZE[keyType];
    if (!sizes) return out;
    const keyAt = r.bodyAt + CERT_HEAD;
    const end = keyAt + sizes[1];
    if (buf.length < end) return out;
    let key = null;
    if (sizes[0]) {
      const n = buf.subarray(keyAt, keyAt + sizes[0]);
      const e = buf.subarray(keyAt + sizes[0], keyAt + sizes[0] + 4);
      try {
        key = createPublicKey({ key: { kty: "RSA", n: n.toString("base64url"), e: e.toString("base64url") }, format: "jwk" });
      } catch { key = null; }
    }
    out.push({
      issuer: text(buf.subarray(r.bodyAt, r.bodyAt + NAME_BYTES)),
      name: text(buf.subarray(r.bodyAt + NAME_BYTES + 4, r.bodyAt + NAME_BYTES + 4 + NAME_BYTES)),
      key, type: r.type, sig: r.sig, signed: buf.subarray(r.bodyAt, end),
    });
    at = end;
  }
  return out;
}

const holds = (data, sig, type, key) => {
  if (!key || type === 0x10005) return false;
  try { return verify("sha256", data, key, sig); } catch { return false; }
};

/** Whether the ticket's signature holds against the certificates of the same package. Pure. */
export function ticketSigned(tik, cert) {
  if (!Buffer.isBuffer(tik) || !Buffer.isBuffer(cert)) return false;
  const t = recordAt(tik, 0);
  if (!t) return false;
  const issuer = text(tik.subarray(t.bodyAt, t.bodyAt + NAME_BYTES));
  const cut = issuer.lastIndexOf("-");
  if (cut < 0) return false;
  const certs = readCerts(cert);
  const signer = certs.find((c) => c.name === issuer.slice(cut + 1) && c.issuer === issuer.slice(0, cut));
  if (!signer || !holds(tik.subarray(t.bodyAt), t.sig, t.type, signer.key)) return false;
  // The XS certificate is in turn signed by the CA named in its issuer ("Root-CA00000003").
  const upCut = signer.issuer.lastIndexOf("-");
  if (upCut < 0) return false;
  const ca = certs.find((c) => c.name === signer.issuer.slice(upCut + 1) && c.issuer === signer.issuer.slice(0, upCut));
  return Boolean(ca) && holds(signer.signed, signer.sig, signer.type, ca.key);
}
