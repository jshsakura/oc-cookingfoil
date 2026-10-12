import fs from "node:fs";
import path from "node:path";

const NAME_TID = /\[(0100[0-9A-Fa-f]{12})\]/g;

/** Base title ids named in the library's file names ("Game [0100…000][v0].nsp"). Pure. */
export function baseIdsInNames(names) {
  const out = new Set();
  for (const n of names) {
    for (const m of n.matchAll(NAME_TID)) {
      const tid = m[1].toUpperCase();
      if ((BigInt(`0x${tid}`) & 0x1fffn) === 0n) out.add(tid);
    }
  }
  return out;
}

/** Every base game the ROM library holds. */
export function ownedTitleIds(root) {
  const names = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(dir, e.name));
      else names.push(e.name);
    }
  };
  walk(root);
  return baseIdsInNames(names);
}
