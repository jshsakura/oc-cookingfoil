/**
 * A patch as its author zipped it, turned into the SD-root layout the server keeps
 * (atmosphere/contents/<title id>/…, atmosphere/exefs_patches/…, SaltySD's FPSLocker
 * folder). Wrapper folders, a missing atmosphere/, the title folder alone, the old SX OS
 * titles/ folder and a bare romfs/ or exefs/ all land the same way; macOS and Windows
 * leftovers and the notes or pictures beside the patch are dropped. Both the upload form
 * and anything registering a patch for someone go through here, so they get one result.
 */
import { kindOf } from "./user-patches.js";
import { coded } from "./meta-messages.js";
import { UploadError } from "./library-upload.js";

const HEX16 = /^[0-9a-f]{16}$/i;
const JUNK_NAME = /^(\.ds_store|thumbs\.db|desktop\.ini)$|^\._/i;
const NOTE_EXT = /\.(txt|md|pdf|rtf|docx?|html?|url|nfo|png|jpe?g|gif|webp|bmp)$/i;
const CONTENT_DIRS = new Set(["romfs", "exefs", "cheats"]);

const bad = (code, vars) => coded(new UploadError(400, ""), code, vars);
const baseOf = (tid) => ((BigInt(`0x${tid}`) >> 13n) << 13n).toString(16).toUpperCase().padStart(16, "0");
const below = (parts) => (parts.length && CONTENT_DIRS.has(parts[0].toLowerCase()) ? [parts[0].toLowerCase(), ...parts.slice(1)] : parts);

/**
 * Where one path's patch content starts: { tid, rest } for a game's own folder (tid null for a
 * bare romfs/, exefs/ or cheats/ that takes the picked game), { to } for a path kept as it is
 * under the SD root, or null when no patch content is in it.
 */
function contentOf(parts) {
  const lower = parts.map((p) => p.toLowerCase());
  for (let i = 0; i < parts.length - 1; i++) {
    const [a, b, c] = lower.slice(i, i + 3);
    if (a === "atmosphere" && (b === "contents") && HEX16.test(c ?? "")) return { tid: c.toUpperCase(), rest: parts.slice(i + 3) };
    if (a === "atmosphere" && b === "exefs_patches") return { to: ["atmosphere", "exefs_patches", ...parts.slice(i + 2)].join("/") };
    if ((a === "contents" || a === "titles") && HEX16.test(b ?? "")) return { tid: b.toUpperCase(), rest: parts.slice(i + 2) };
    if (HEX16.test(a)) return { tid: a.toUpperCase(), rest: parts.slice(i + 1) };
    if (a === "exefs_patches") return { to: ["atmosphere", "exefs_patches", ...parts.slice(i + 1)].join("/") };
    if (lower.slice(i, i + 4).join("/") === "saltysd/plugins/fpslocker/patches" && HEX16.test(lower[i + 4] ?? "")) {
      return { to: parts.slice(i).join("/"), fpsTid: lower[i + 4].toUpperCase() };
    }
    if (CONTENT_DIRS.has(a)) return { tid: null, rest: parts.slice(i) };
  }
  return null;
}

/**
 * The plan for one upload: { files: [{ from, to }], dropped: [path], titleId }. `titleId` is
 * the base game picked, or null to read it from the patch's own title folder (an update's or
 * add-on's folder names its base game). Throws an UploadError with a meta-messages key. Pure.
 */
export function patchPlan(paths, titleId) {
  const picked = titleId ? String(titleId).toUpperCase() : null;
  const dropped = [];
  const found = [];
  for (const from of paths) {
    const parts = String(from).split("/");
    if (parts.some((p) => !p || p === "." || p === ".." || p.includes("\\") || p.includes("\0"))) throw bad("upload.notPatchPath", { titleId: picked ?? "?", path: from });
    const name = parts.at(-1);
    if (parts.some((p) => p === "__MACOSX") || JUNK_NAME.test(name)) { dropped.push(from); continue; }
    if (name.toLowerCase() === "patch.json") throw bad("upload.patchJsonInside", {});
    const hit = contentOf(parts);
    if (hit) { found.push({ from, ...hit }); continue; }
    if (NOTE_EXT.test(name) || /^(readme|license|licence)$/i.test(name)) { dropped.push(from); continue; }
    throw bad("upload.notPatchPath", { titleId: picked ?? "?", path: from });
  }
  if (!found.length) throw bad("upload.noPatchFiles", {});
  const games = new Set(found.map((f) => f.tid ?? f.fpsTid).filter(Boolean).map(baseOf));
  const game = picked ?? (games.size === 1 ? [...games][0] : null);
  if (!game) throw bad("upload.patchNeedsGame", {});
  const files = found.map((f) => {
    const to = f.to ?? ["atmosphere", "contents", f.tid ?? game, ...below(f.rest)].join("/");
    if (kindOf(to, game) === null) throw bad("upload.notPatchPath", { titleId: game, path: f.from });
    return { from: f.from, to };
  });
  return { files, dropped, titleId: game };
}
