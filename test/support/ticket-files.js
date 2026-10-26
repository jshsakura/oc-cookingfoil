// Synthetic tickets and certificate chains for the ticket signature tests: keys made here, never real ones.
import { generateKeyPairSync, sign } from "node:crypto";

const RSA4096 = 0x10003;
const RSA2048 = 0x10004;
const SIG_SIZE = { [RSA4096]: 0x200, [RSA2048]: 0x100 };
const align = (n) => Math.ceil(n / 0x40) * 0x40;

const name64 = (s) => { const b = Buffer.alloc(0x40); b.write(s, "latin1"); return b; };

function keyPair(bits) {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: bits, publicExponent: 0x10001 });
  const jwk = publicKey.export({ format: "jwk" });
  return { privateKey, n: Buffer.from(jwk.n, "base64url"), e: Buffer.from(jwk.e, "base64url") };
}

/** A record: signature type, signature over `body` by `signer` (or `sigBytes` as given), padding, body. */
function record(type, body, signer, sigBytes) {
  const head = Buffer.alloc(align(4 + SIG_SIZE[type]));
  head.writeUInt32BE(type, 0);
  const sig = sigBytes ?? sign("sha256", body, signer);
  sig.copy(head, 4);
  return Buffer.concat([head, body]);
}

/** A certificate named `name` by `issuer` holding `key` (RSA), signed by `signer` with `sigType`. */
function cert({ issuer, name, key, signer, sigType }) {
  const keyType = key.n.length === 0x200 ? 0 : 1;
  const head = Buffer.alloc(0x40 + 4 + 0x40 + 4);
  name64(issuer).copy(head, 0);
  head.writeUInt32BE(keyType, 0x40);
  name64(name).copy(head, 0x44);
  const exp = Buffer.alloc(4);
  key.e.copy(exp, 4 - key.e.length);
  const body = Buffer.concat([head, key.n, exp, Buffer.alloc(0x34)]);
  return record(sigType, body, signer);
}

let made = null;
/** One chain for the whole run: Root (not in the package) -> CA00000003 (RSA-4096) -> XS00000020 (RSA-2048). */
export function chain() {
  if (made) return made;
  const root = keyPair(4096);
  const ca = keyPair(4096);
  const xs = keyPair(2048);
  const caCert = cert({ issuer: "Root", name: "CA00000003", key: ca, signer: root.privateKey, sigType: RSA4096 });
  const xsCert = cert({ issuer: "Root-CA00000003", name: "XS00000020", key: xs, signer: ca.privateKey, sigType: RSA4096 });
  made = { ca, xs, caCert, xsCert, certFile: Buffer.concat([caCert, xsCert]) };
  return made;
}

/** A ticket body (0x180 bytes) naming `issuer`; `mark` changes its bytes. */
function ticketBody(issuer, mark) {
  const body = Buffer.alloc(0x180);
  name64(issuer).copy(body, 0);
  body.write(mark, 0x40, "latin1");
  return body;
}

/** A ticket signed by the chain's XS key; `fake` fills the signature with 0xFF as repackers do. */
export function ticket({ issuer = "Root-CA00000003-XS00000020", mark = "TITLEKEY", fake = false } = {}) {
  const body = ticketBody(issuer, mark);
  return record(RSA2048, body, chain().xs.privateKey, fake ? Buffer.alloc(0x100, 0xff) : undefined);
}
