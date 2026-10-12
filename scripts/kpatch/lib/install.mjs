/**
 * Putting a LayeredFS package into <patches>/<tid>/한글패치/. The server's own
 * patchLayout check runs on the result, so anything installed here is a patch
 * the shop will accept. A replacement is built beside the old one and swapped
 * in only when complete.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { patchLayout, unzip, walk } from "../../../src/meta/library-upload.js";
import { packageKind, toSdRoot } from "./layout.mjs";

export const PATCH_NAME = "한글패치";

/** Unpack a downloaded zip into `dir` and return its files. */
export async function unpack(zip, dir) {
  await fsp.rm(dir, { recursive: true, force: true });
  await fsp.mkdir(dir, { recursive: true });
  await unzip(zip, dir);
  return walk(dir);
}

/**
 * Install unpacked files for `tid`. Returns { kind, installed, dropped } and
 * installs only when kind is "layeredfs".
 */
export async function installPatch({ files, tid, meta, patchesDir, replace = false, dryRun = false }) {
  const kind = packageKind(files.map((f) => f.rel));
  if (kind !== "layeredfs") return { kind, installed: 0, dropped: [] };
  const { files: placed, dropped } = toSdRoot(files.map((f) => f.rel), tid);
  if (!placed.length) return { kind: "unknown", installed: 0, dropped };
  patchLayout(placed.map((p) => p.to), tid);

  const dest = path.join(patchesDir, tid, PATCH_NAME);
  if (fs.existsSync(dest) && !replace) throw new Error(`이미 있습니다: ${dest}`);
  if (dryRun) return { kind, installed: placed.length, dropped };

  const staging = path.join(patchesDir, tid, `.${PATCH_NAME}.incoming`);
  await fsp.rm(staging, { recursive: true, force: true });
  const byRel = new Map(files.map((f) => [f.rel, f.abs]));
  for (const p of placed) {
    const to = path.join(staging, p.to);
    await fsp.mkdir(path.dirname(to), { recursive: true });
    await fsp.copyFile(byRel.get(p.from), to);
  }
  await fsp.writeFile(path.join(staging, "patch.json"), `${JSON.stringify(meta, null, 2)}\n`);
  await fsp.rm(dest, { recursive: true, force: true });
  await fsp.rename(staging, dest);
  return { kind, installed: placed.length, dropped };
}

/** "게임 1.1.7 대응입니다." from a build named for one game version ("…_for_1.1.7_PUK.zip"), else null. Pure. */
export function gameVersionNote(fileName) {
  const m = String(fileName ?? "").match(/for[_-]?(\d+(?:\.\d+)+)(?:[_-](PUK|PK))?/i);
  if (!m) return null;
  return `게임 ${m[1]}${m[2] ? " (파워업키트)" : ""} 대응입니다.`;
}

/** patch.json for a patch this tool installs. Pure. */
export function patchMeta({ version, author, sourceUrl, articleUrl, note }) {
  const meta = { name: PATCH_NAME };
  if (version) meta.version = version;
  if (author) meta.author = author;
  meta.description = [note, `원본: ${articleUrl ?? sourceUrl}`].filter(Boolean).join(" ");
  return meta;
}
