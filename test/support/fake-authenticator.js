// A software passkey for tests: a P-256 key that answers WebAuthn ceremonies the way a phone's
// authenticator would (attestation "none", user verified unless told otherwise).
import crypto from "node:crypto";

const b64u = (buf) => Buffer.from(buf).toString("base64url");

function cbor(value) {
  const head = (major, n) => {
    if (n < 24) return Buffer.from([(major << 5) | n]);
    if (n < 256) return Buffer.from([(major << 5) | 24, n]);
    const b = Buffer.alloc(3); b[0] = (major << 5) | 25; b.writeUInt16BE(n, 1); return b;
  };
  if (Number.isInteger(value)) return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (Buffer.isBuffer(value)) return Buffer.concat([head(2, value.length), value]);
  if (typeof value === "string") { const b = Buffer.from(value); return Buffer.concat([head(3, b.length), b]); }
  const entries = value instanceof Map ? [...value] : Object.entries(value);
  return Buffer.concat([head(5, entries.length), ...entries.flatMap(([k, v]) => [cbor(k), cbor(v)])]);
}

export function fakeAuthenticator({ origin, verified = true } = {}) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" });
  const id = crypto.randomBytes(32);
  let count = 0;
  const flags = (extra) => 0x01 | (verified ? 0x04 : 0) | extra;
  const clientData = (type, challenge, at) => Buffer.from(JSON.stringify({ type, challenge, origin: at ?? origin, crossOrigin: false }));
  return {
    id: b64u(id),
    /** The browser's answer to registration options. */
    create(options, { at } = {}) {
      const rpHash = crypto.createHash("sha256").update(options.rp.id).digest();
      const cose = cbor(new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, "base64url")], [-3, Buffer.from(jwk.y, "base64url")]]));
      const len = Buffer.alloc(2); len.writeUInt16BE(id.length);
      const authData = Buffer.concat([rpHash, Buffer.from([flags(0x40)]), Buffer.alloc(4), Buffer.alloc(16), len, id, cose]);
      const attestation = cbor(new Map([["fmt", "none"], ["attStmt", new Map()], ["authData", authData]]));
      return {
        id: b64u(id), rawId: b64u(id), type: "public-key", clientExtensionResults: {},
        response: { clientDataJSON: b64u(clientData("webauthn.create", options.challenge, at)), attestationObject: b64u(attestation), transports: ["internal"] },
      };
    },
    /** The browser's answer to sign-in options, for the host `rpID`. */
    get(options, { rpID = options.rpId, at } = {}) {
      count += 1;
      const ctr = Buffer.alloc(4); ctr.writeUInt32BE(count);
      const authData = Buffer.concat([crypto.createHash("sha256").update(rpID).digest(), Buffer.from([flags(0)]), ctr]);
      const cd = clientData("webauthn.get", options.challenge, at);
      const signature = crypto.sign("sha256", Buffer.concat([authData, crypto.createHash("sha256").update(cd).digest()]), privateKey);
      return {
        id: b64u(id), rawId: b64u(id), type: "public-key", clientExtensionResults: {},
        response: { clientDataJSON: b64u(cd), authenticatorData: b64u(authData), signature: b64u(signature) },
      };
    },
  };
}
