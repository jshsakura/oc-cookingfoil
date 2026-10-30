/**
 * What a hash database (retro/hash-db.js) says each ROM in the drop box is: for a plain file its
 * bytes' CRC-32 (and the same without a copier or iNES header), for a zip the CRC-32 its directory
 * holds for its one ROM, for a .cue the first track it names. rel → { systems, name } when a dump
 * matches; a file nobody lists is simply absent. Hashes are kept per file while its fileKey holds,
 * so a sweep that runs again reads nothing twice.
 */
import { createReadStream } from "node:fs";
import path from "node:path";
import { fileKey } from "../helpers/hash-cache.js";
import { zipDirectory } from "../helpers/zip-read.js";
import { listArchive } from "../helpers/seven-zip-list.js";
import { chdFirstTrack } from "../helpers/chd-track.js";
import { hashRom, MAX_BYTES } from "../retro/rom-index.js";
import { koreanNamesByCrc } from "../retro/ko-names.js";
import { systemOfExtension } from "../retro/systems.js";

// Not a ROM of any console: never hashed.
// A .pbp, .cso or .rvz is compressed data whose bytes are not what No-Intro and Redump list: reading one in full would
// find nothing. A .chd too, and the SHA-1 in its header covers 2448-byte frames with subcode; chdtrack decodes its first track instead.
const SKIP = new Set([".cue", ".m3u", ".nro", ".png", ".md", ".txt", ".nfo", ".rar", ".scummvm", ".chd", ".pbp", ".cso", ".rvz"]);
const DOCS = new Set([".txt", ".nfo", ".diz", ".pdf", ".jpg", ".png", ".md", ".htm", ".html"]);

export function createDropHasher({ lookup, lookupKo = koreanNamesByCrc, chdTrack = chdFirstTrack }) {
  const seen = new Map(); // abs → { key, crcs: [{ crc32, size }] }

  async function crcsOf(f, systems) {
    const ext = path.extname(f.abs).toLowerCase();
    if (ext === ".zip") {
      const roms = (await zipDirectory(f.abs).catch(() => [])).filter((e) => !e.name.endsWith("/") && !DOCS.has(path.extname(e.name).toLowerCase()));
      return roms.length === 1 ? [{ crc32: roms[0].crc32, size: roms[0].size }] : [];
    }
    if (ext === ".7z") {
      const roms = (await listArchive(f.abs)).filter((e) => !DOCS.has(path.extname(e.name).toLowerCase()));
      return roms.length === 1 && roms[0].crc32 ? [{ crc32: roms[0].crc32, size: roms[0].size }] : [];
    }
    if (ext === ".chd") return chdTrack(f.abs);
    if (SKIP.has(ext) || f.size > MAX_BYTES) return [];
    const h = await hashRom(createReadStream(f.abs), systemOfExtension(ext, systems), f.size);
    return [{ crc32: h.crc32, size: f.size }, ...(h.bare ? [{ crc32: h.bare.crc32, size: null }] : [])];
  }

  /** rel → { systems: [id], name } for the `files` ([{ rel, abs, size, ... }]) a dump matches. */
  async function identify(files, refs, systems) {
    const byRel = new Map(files.map((f) => [f.rel, f]));
    const out = new Map();
    for (const f of files) {
      const ext = path.extname(f.rel).toLowerCase();
      const source = ext === ".cue" ? byRel.get(refs.get(f.rel)?.[0]) : f;
      if (!source) continue;
      const key = fileKey(source);
      let hit = seen.get(source.abs);
      if (hit?.key !== key) {
        hit = { key, crcs: await crcsOf(source, systems).catch(() => []) };
        seen.set(source.abs, hit);
      }
      for (const { crc32, size } of hit.crcs) {
        const dumps = lookup(crc32, size).filter((d) => systems[d.system]);
        const korean = lookupKo(crc32).filter((k) => systems[k.system]);
        if (!dumps.length && !korean.length) continue;
        // The lists name the original dump; the plugin's dictionary also knows Korean-patched ROMs, which no list has.
        const ids = [...new Set((dumps.length ? dumps : korean).map((d) => d.system))];
        const ko = korean.find((k) => ids.includes(k.system));
        out.set(f.rel, { systems: ids, name: dumps[0]?.name ?? ko.en ?? ko.ko, crc32, ...(ko ? { ko: ko.ko } : {}) });
        break;
      }
    }
    const present = new Set(files.map((f) => f.abs));
    for (const abs of seen.keys()) if (!present.has(abs)) seen.delete(abs);
    return out;
  }

  return { identify };
}
