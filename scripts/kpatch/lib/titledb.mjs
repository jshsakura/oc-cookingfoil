import fs from "node:fs";
import path from "node:path";

const REGIONS = ["KR.ko", "JP.ja", "US.en", "GB.en", "HK.zh"];

/** Map of base title id -> { KR, JP, US, … names } from the server's titledb. */
export function loadTitleIndex(dir) {
  const index = new Map();
  for (const region of REGIONS) {
    const file = path.join(dir, `${region}.slim.json`);
    if (!fs.existsSync(file)) continue;
    for (const v of Object.values(JSON.parse(fs.readFileSync(file, "utf8")))) {
      if (!v?.id || !v.name) continue;
      const tid = v.id.toUpperCase();
      if ((BigInt(`0x${tid}`) & 0x1fffn) !== 0n) continue;
      const names = index.get(tid) ?? {};
      names[region.slice(0, 2)] = v.name;
      index.set(tid, names);
    }
  }
  if (!index.size) throw new Error(`titledb 가 비어 있습니다: ${dir}`);
  return index;
}

/** One display name for a title id: Korean, then Japanese, then English. Pure. */
export const titleName = (index, tid) => {
  const n = index.get(tid) ?? {};
  return n.KR ?? n.JP ?? n.US ?? n.GB ?? n.HK ?? tid;
};
