/**
 * A Vita homebrew's .vpk, read from its zip directory without unpacking it: its param.sfo (title id, name,
 * APP_VER) and its icon. Read as the Vita client and the Vita client update read them (meta/vita-build.js).
 */
import { entryStream, zipDirectory } from "../helpers/zip-read.js";
import { parseSfo } from "../backups/vita-scan.js";

const SFO_MAX = 64 * 1024;
const ICON_MAX = 1024 * 1024;

async function entryBytes(abs, entries, name, max) {
  const entry = entries.find((e) => e.name === name);
  if (!entry || entry.size > max) return null;
  const stream = await entryStream(abs, entry);
  if (!stream) return null;
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

/** { titleId, name, version } of the .vpk at `abs`, or null when it is no Vita app this can read. */
export async function readVpk(abs) {
  const entries = await zipDirectory(abs).catch(() => []);
  const data = entries.length ? await entryBytes(abs, entries, "sce_sys/param.sfo", SFO_MAX).catch(() => null) : null;
  const sfo = data && parseSfo(data);
  if (!sfo || !/^[A-Z0-9]{9}$/.test(sfo.TITLE_ID ?? "") || !/^\d{2}\.\d{2}$/.test(sfo.APP_VER ?? "")) return null;
  return { titleId: sfo.TITLE_ID, name: sfo.TITLE || null, version: sfo.APP_VER };
}

/** The .vpk's sce_sys/icon0.png, or null. */
export async function vpkIcon(abs) {
  const entries = await zipDirectory(abs).catch(() => []);
  return entries.length ? entryBytes(abs, entries, "sce_sys/icon0.png", ICON_MAX).catch(() => null) : null;
}
