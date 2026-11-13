/**
 * The first backup of a console, taken from a copy of its card already on the server (scripts/import-backup.mjs)
 * instead of over the console's slow wireless. The copy is only read. Units, manifests and sealed secrets are
 * made exactly as a console's upload makes them, and a unit whose newest version has the same manifest is left
 * as it is, so running it again adds nothing. What it reports is counts and bytes: no title, path or hash.
 */
import zlib from "node:zlib";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { pipeline } from "node:stream/promises";
import { scanUx0, manifestOf } from "./vita-scan.js";
import { normalizeManifest } from "./manifest.js";
import * as store from "./store.js";
import { sealSecret, secretName, secretPlace } from "./secrets.js";
import { SECRET_MAX_BYTES } from "./uploads.js";

const PLATFORM = "vita";

// A body read once: hashed while it is copied in, kept when the account lacks it.
async function takeBody(accountId, file) {
  const tmpDir = path.join(store.accountDir(accountId), "blobs", `.import-${process.pid}`);
  await fsp.mkdir(tmpDir, { recursive: true });
  const tmp = path.join(tmpDir, crypto.randomBytes(8).toString("hex"));
  const hash = crypto.createHash("sha256");
  let crc = 0;
  await pipeline(fs.createReadStream(file, { highWaterMark: 4 * 1024 ** 2 }), async function* (source) {
    for await (const chunk of source) {
      hash.update(chunk);
      crc = zlib.crc32(chunk, crc);
      yield chunk;
    }
  }, fs.createWriteStream(tmp));
  const sha256 = hash.digest("hex");
  const blob = store.blobPath(accountId, sha256);
  if (store.hasBlob(accountId, sha256)) await fsp.rm(tmp, { force: true });
  else {
    await fsp.mkdir(path.dirname(blob), { recursive: true });
    await fsp.rename(tmp, blob);
  }
  // Noted for a body the account had too: one kept before CRCs were gets its CRC from this same read.
  await store.noteBlobCrc(accountId, sha256, crc);
  return sha256;
}

async function importUnit(accountId, unit) {
  const key = `${unit.kind}:${unit.id}`;
  const [latest] = await store.unitVersions(accountId, PLATFORM, key);
  // A file the newest version already has, same size and time, is not read again.
  const known = new Map((latest?.manifest.files ?? []).map((f) => [f.path, f]));
  const hash = async (f) => {
    const was = known.get(f.path);
    if (was && was.size === f.size && was.mtime === f.mtime && store.hasBlob(accountId, was.sha256)) return was.sha256;
    return takeBody(accountId, f.source);
  };
  const manifest = normalizeManifest(PLATFORM, key, await manifestOf(unit, hash));
  if (!manifest) throw new Error("a unit on the card does not make a manifest this server takes");
  if (latest && JSON.stringify(latest.manifest) === JSON.stringify(manifest)) return { added: false, manifest };
  const version = await store.takeVersion(accountId, PLATFORM, key);
  if (manifest.secrets.length) {
    const into = store.secretDir(accountId, PLATFORM, key, version);
    await fsp.mkdir(into, { recursive: true });
    for (const f of unit.files.filter((file) => file.secret)) {
      if (f.size > SECRET_MAX_BYTES) throw new Error("a secret file on the card is larger than the server takes");
      const plain = await fsp.readFile(f.source);
      const sealed = sealSecret(plain, secretPlace(accountId, PLATFORM, key, version, f.path));
      plain.fill(0);
      await fsp.writeFile(path.join(into, secretName(f.path)), sealed);
    }
  }
  await store.commitVersion(accountId, PLATFORM, key, version, manifest, { label: "import" });
  return { added: true, manifest };
}

/**
 * Imports the card copy at `ux0` into `accountId`'s Vita backups (only `kinds`, when given). `dry` scans and
 * counts without writing. `report` is told the counts as it goes.
 */
export async function importUx0({ ux0, accountId, kinds = null, dry = false, report = () => {} }) {
  const units = (await scanUx0(ux0)).filter((u) => !kinds || kinds.includes(u.kind));
  const totals = { units: units.length, files: 0, secrets: 0, bytes: 0, added: 0, kept: 0 };
  for (const unit of units) {
    totals.files += unit.files.filter((f) => !f.secret).length;
    totals.secrets += unit.files.filter((f) => f.secret).length;
    totals.bytes += unit.files.reduce((n, f) => n + f.size, 0);
  }
  if (dry) return totals;
  let done = 0;
  for (const unit of units) {
    const { added } = await importUnit(accountId, unit);
    if (added) totals.added++;
    else totals.kept++;
    report({ done: ++done, of: units.length });
  }
  await fsp.rm(path.join(store.accountDir(accountId), "blobs", `.import-${process.pid}`), { recursive: true, force: true });
  return totals;
}
