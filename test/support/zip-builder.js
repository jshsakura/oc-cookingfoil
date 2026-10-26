/**
 * Builds zip files by hand, including the malformed ones a real archiver refuses to write: names with
 * "..", symlink entries, encrypted flags, duplicates. Only for tests of the plugin unpacker.
 *
 * zip([{ name, data?, method?: "store"|"deflate", mode?, host?, encrypted?, claim? }]) -> Buffer
 *   mode: unix st_mode (e.g. 0o120777 for a symlink); host: "unix" (default) or "dos"
 *   claim: uncompressed size to write in the headers instead of the real one
 */
import zlib from "node:zlib";

const crc32 = (buf) => zlib.crc32(buf);

export function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name);
    const raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data ?? "");
    const method = e.method === "store" ? 0 : 8;
    const body = method === 0 ? raw : zlib.deflateRawSync(raw);
    const flags = e.encrypted ? 1 : 0;
    const size = e.claim ?? raw.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc32(raw), 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(((e.host === "dos" ? 0 : 3) << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc32(raw), 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(e.host === "dos" ? 0 : ((e.mode ?? (e.name.endsWith("/") ? 0o40755 : 0o100644)) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + body.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

export const PLUGIN_JSON = JSON.stringify({ id: "demo", apiVersion: 1, version: "1.2.0", name: { en: "Demo" }, provides: ["metadata"] });
export const INDEX_JS = "export default { async metadata() { return {}; } };";
export const good = (extra = []) => [{ name: "plugin.json", data: PLUGIN_JSON }, { name: "index.js", data: INDEX_JS }, ...extra];
