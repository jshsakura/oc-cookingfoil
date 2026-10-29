/**
 * What is inside a .7z (or any archive 7-Zip reads), without unpacking it: each entry's path,
 * size and CRC-32 from the archive's own headers, through the bundled 7-Zip (sevenZipBin()).
 * [] when there is no 7-Zip, the archive cannot be read, or it is encrypted.
 */
import { spawn } from "node:child_process";
import { sevenZipBin } from "../retro/pack-bundle.js";

const LIST_MS = 30_000;
const MAX_OUT = 4 * 1024 * 1024;

/** The entries of `7z l -slt` output: [{ name, size, crc32 }] for files only. Pure. */
export function parseSlt(text) {
  const out = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    const f = {};
    for (const line of block.split(/\r?\n/)) {
      const at = line.indexOf(" = ");
      if (at > 0) f[line.slice(0, at)] = line.slice(at + 3);
    }
    if (f.Path === undefined || f.Folder === "+" || /^D/.test(f.Attributes ?? "") || f.Encrypted === "+") continue;
    out.push({ name: f.Path.replace(/\\/g, "/"), size: Number(f.Size ?? 0), crc32: /^[0-9A-Fa-f]{8}$/.test(f.CRC ?? "") ? f.CRC.toLowerCase() : null });
  }
  return out;
}

export function listArchive(abs, { bin = sevenZipBin() } = {}) {
  if (!bin) return Promise.resolve([]);
  return new Promise((resolve) => {
    const child = spawn(bin, ["l", "-slt", "-ba", "-bd", "--", abs], { stdio: ["ignore", "pipe", "ignore"] });
    let text = "";
    const timer = setTimeout(() => child.kill(), LIST_MS);
    child.stdout.on("data", (d) => { if (text.length < MAX_OUT) text += d; });
    child.on("error", () => { clearTimeout(timer); resolve([]); });
    child.on("close", (code) => { clearTimeout(timer); resolve(code === 0 ? parseSlt(text) : []); });
  });
}
