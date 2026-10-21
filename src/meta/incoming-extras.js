/**
 * What the games folder's drop box (library-organize.js) does with files that
 * are not Switch packages: retro ROMs go to retro/roms/<system>/, a lone
 * homebrew .nro to homebrew/<name>/. Everything else stays, with why.
 *
 * A ROM's system is the one the operator chose: the folder it was dropped in
 * (incoming/snes/, incoming/PlayStation/, …). Nothing is guessed from an
 * extension; it only tells what looks wrong (a .gba in snes/, a ROM outside
 * any system folder) and the file stays with that warning. A .cue or .m3u
 * takes the files it names along, into a folder of its own. ROMs keep their names.
 */
import path from "path";
import { systemOfFolder, systemOfExtension } from "../retro/systems.js";

// Too common to hint at a system: a picture is rarely a PICO-8 cart.
const NO_HINT = new Set([".png"]);
const LISTS = new Set([".cue", ".m3u"]);

export const EXTRA_REASONS = Object.freeze({
  noSystem: "기종 폴더에 넣어야 옮깁니다. incoming 안에 기종 이름 폴더(snes, gba, ps1 등)를 만들어 넣습니다",
  wrongExtension: "이 기종에서 쓰지 않는 확장자라 옮기지 않았습니다. 기종 폴더가 맞는지 확인합니다",
  scummvm: "ScummVM 게임은 폴더째 업로드 탭에서 올립니다",
  homebrewFolder: "폴더째 쓰는 홈브류는 업로드 탭에서 올립니다",
  patch: "패치와 세이브는 업로드 탭에서 올립니다",
  missingPart: "목록 파일이 가리키는 파일이 임시 폴더에 없습니다",
  unknown: "어디로 보낼지 모르는 파일입니다",
});

/** The system named by the nearest folder above `rel` in the drop box, or null. Pure. */
function systemFromFolders(rel, systems) {
  const dirs = path.posix.dirname(rel).split("/").filter((d) => d && d !== ".");
  for (const d of dirs.reverse()) {
    const id = systemOfFolder(d, systems);
    if (id) return id;
  }
  return null;
}

/** A folder name for a homebrew app or a disc set, from a file name; null when nothing is left. Pure. */
export function setFolderOf(fileName) {
  const stem = path.posix.basename(fileName, path.posix.extname(fileName))
    .normalize("NFC").replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g, "").replace(/\s+/g, " ").replace(/^[\s.]+|[\s.]+$/g, "").slice(0, 100).trim();
  return stem || null;
}

/**
 * The plan for the drop box's other files. `items` is [{ rel }] (settled, not
 * Switch packages), `refs` maps a .cue/.m3u rel to the rels it names (resolved
 * inside the drop box), `systems` is loadSystems(). Moves are
 * { from, root: "retro" | "homebrew", to, system? }; `to` is relative to that root. Pure.
 */
export function planExtras({ items = [], refs = new Map(), systems = {} }) {
  const moves = [];
  const held = [];
  const rels = new Set(items.map((i) => i.rel));
  const claimed = new Set();
  for (const parts of refs.values()) for (const p of parts) claimed.add(p);
  const byDir = new Map();
  for (const { rel } of items) {
    const d = path.posix.dirname(rel);
    byDir.set(d, [...(byDir.get(d) ?? []), rel]);
  }

  for (const { rel } of [...items].sort((a, b) => a.rel.localeCompare(b.rel))) {
    if (claimed.has(rel) && !refs.has(rel)) continue; // goes with its list
    const ext = path.posix.extname(rel).toLowerCase();
    const name = path.posix.basename(rel);
    const top = rel.split("/")[0].toLowerCase();
    if (top === "atmosphere" || rel.toLowerCase().includes("/atmosphere/")) { held.push({ rel, reason: EXTRA_REASONS.patch }); continue; }
    if (ext === ".nro") {
      // A .nro with other files beside it is a folder app (a port and its data).
      const beside = (byDir.get(path.posix.dirname(rel)) ?? []).filter((r) => r !== rel);
      const folder = setFolderOf(name);
      if (beside.length && path.posix.dirname(rel) !== ".") { held.push({ rel, reason: EXTRA_REASONS.homebrewFolder }); continue; }
      if (!folder) { held.push({ rel, reason: EXTRA_REASONS.unknown }); continue; }
      moves.push({ from: rel, root: "homebrew", to: `${folder}/${name}` });
      continue;
    }
    if (ext === ".scummvm") { held.push({ rel, reason: EXTRA_REASONS.scummvm }); continue; }
    const system = systemFromFolders(rel, systems);
    const romLike = LISTS.has(ext) || Object.values(systems).some((s) => s.extensions.includes(ext));
    // What the extension alone suggests, said in the warning and never acted on.
    const hint = NO_HINT.has(ext) ? null : systemOfExtension(ext, systems);
    const looks = hint && hint !== system ? `. ${systems[hint].names?.ko ?? hint} 롬으로 보입니다` : "";
    if (!system) {
      held.push({ rel, reason: romLike ? EXTRA_REASONS.noSystem + looks : EXTRA_REASONS.unknown, system: null, hint });
      continue;
    }
    if (!systems[system].extensions.includes(ext) && !LISTS.has(ext)) {
      held.push({ rel, reason: romLike ? EXTRA_REASONS.wrongExtension + looks : EXTRA_REASONS.unknown, system, hint });
      continue;
    }
    const base = systems[system].folder;
    if (refs.has(rel)) {
      const parts = refs.get(rel);
      if (parts.some((p) => !rels.has(p))) { held.push({ rel, reason: EXTRA_REASONS.missingPart, system }); continue; }
      const set = setFolderOf(name);
      const dir = path.posix.dirname(rel);
      for (const r of [rel, ...parts]) {
        const inner = dir === "." ? r : r.slice(dir.length + 1);
        moves.push({ from: r, root: "retro", to: `roms/${base}/${set}/${inner}`, system });
      }
      continue;
    }
    moves.push({ from: rel, root: "retro", to: `roms/${base}/${name}`, system });
  }
  return { moves, held };
}
