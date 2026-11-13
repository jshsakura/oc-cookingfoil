/**
 * The Vita client's build (GET /api/client/latest?platform=vita): a .vpk dropped at <data dir>/client/cookingfoil.vpk.
 * Whenever its size or mtime changes it is read again: a zip holding sce_sys/param.sfo with an APP_VER, whose
 * value is the version offered as it is written there ("01.05"). A build that passes is copied to
 * client/.published/, and that copy is what is offered and served, so size and sha256 describe the bytes sent.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "../helpers/envs.js";
import { entryData, zipEntries } from "../helpers/zip-read.js";
import { parseSfo } from "../backups/vita-scan.js";
import { ClientBuildError } from "./client-build.js";
import debug from "../debug.js";

export const VITA_VPK = path.join(dataDir, "client", "cookingfoil.vpk");
const PUBLISHED_VPK = path.join(dataDir, "client", ".published", "cookingfoil.vpk");
export const VPK_URL = "/api/client/cookingfoil.vpk";
const MAX_BUILD_BYTES = 128 * 1024 * 1024;

/** { version, titleId } of a .vpk held in `buf`, or a ClientBuildError. Pure. */
export function inspectVpk(buf) {
  const entries = buf.length >= 4 && buf.readUInt32LE(0) === 0x04034b50 ? zipEntries(buf) : null;
  if (!entries) throw new ClientBuildError("not-vpk", "not a zip");
  const entry = entries.find((e) => e.name === "sce_sys/param.sfo");
  const data = entry && entry.size <= 64 * 1024 ? entryData(buf, entry) : null;
  const sfo = data && parseSfo(data);
  if (!sfo) throw new ClientBuildError("no-sfo", "no readable sce_sys/param.sfo");
  if (!/^\d{2}\.\d{2}$/.test(sfo.APP_VER ?? "")) throw new ClientBuildError("no-version", "param.sfo has no APP_VER like 01.00");
  return { version: sfo.APP_VER, titleId: sfo.TITLE_ID ?? "" };
}

let seen = { key: null, info: null };
let queue = Promise.resolve();

async function lookNow() {
  let st;
  try {
    st = await fs.promises.stat(VITA_VPK);
  } catch {
    seen = { key: null, info: null };
    return;
  }
  const key = `${st.size}\0${st.mtimeMs}`;
  if (!st.isFile() || key === seen.key) return;
  seen = { key, info: null };
  if (st.size > MAX_BUILD_BYTES) return debug.error("client update: the Vita build is %d bytes, more than the server offers", st.size);
  const buf = await fs.promises.readFile(VITA_VPK);
  let version;
  try {
    ({ version } = inspectVpk(buf));
  } catch (err) {
    if (!(err instanceof ClientBuildError)) throw err;
    return debug.error("client update: the Vita build is not offered (%s: %s)", err.code, err.message);
  }
  await fs.promises.mkdir(path.dirname(PUBLISHED_VPK), { recursive: true });
  await fs.promises.writeFile(`${PUBLISHED_VPK}.tmp`, buf);
  await fs.promises.rename(`${PUBLISHED_VPK}.tmp`, PUBLISHED_VPK);
  seen.info = { version, size: buf.length, sha256: crypto.createHash("sha256").update(buf).digest("hex") };
  debug.log("client update: published Vita build %s (%d bytes)", version, buf.length);
}

/** The Vita build being offered, { version, size, sha256, url }, or null when none has passed the checks. */
export async function latestVitaBuild() {
  const next = queue.then(lookNow);
  queue = next.catch((err) => debug.error("client update: Vita build: %s", err.message));
  await next;
  return seen.info ? { ...seen.info, url: VPK_URL } : null;
}

export const publishedVpkPath = () => PUBLISHED_VPK;
