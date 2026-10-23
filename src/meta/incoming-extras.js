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

// Why a file other than a Switch package stays in the drop box, by code, in each admin page language.
// library-organize.js merges these into its REASON_TEXT, so the panel says them like its own.
// {system} is the console the extension suggests, named in the same language.
export const EXTRA_REASON_TEXT = Object.freeze({
  ko: {
    noSystem: "기종 폴더에 넣어야 옮깁니다. incoming 안에 기종 이름 폴더(snes, gba, ps1 등)를 만들어 넣습니다",
    noSystemHint: "기종 폴더에 넣어야 옮깁니다. incoming 안에 기종 이름 폴더(snes, gba, ps1 등)를 만들어 넣습니다. {system} 롬으로 보입니다",
    wrongExtension: "이 기종에서 쓰지 않는 확장자라 옮기지 않았습니다. 기종 폴더가 맞는지 확인합니다",
    wrongExtensionHint: "이 기종에서 쓰지 않는 확장자라 옮기지 않았습니다. 기종 폴더가 맞는지 확인합니다. {system} 롬으로 보입니다",
    scummvm: "ScummVM 게임은 폴더째 업로드 탭에서 올립니다",
    homebrewFolder: "폴더째 쓰는 홈브류는 업로드 탭에서 올립니다",
    patch: "패치와 세이브는 업로드 탭에서 올립니다",
    missingPart: "목록 파일이 가리키는 파일이 임시 폴더에 없습니다",
    unknown: "어디로 보낼지 모르는 파일입니다",
  },
  en: {
    noSystem: "It moves once it is in a console folder. Make a folder named after the console (snes, gba, ps1 and so on) inside incoming and put it there",
    noSystemHint: "It moves once it is in a console folder. Make a folder named after the console (snes, gba, ps1 and so on) inside incoming and put it there. It looks like a {system} ROM",
    wrongExtension: "This console does not use this extension, so it was not moved. Check that the console folder is right",
    wrongExtensionHint: "This console does not use this extension, so it was not moved. Check that the console folder is right. It looks like a {system} ROM",
    scummvm: "Upload ScummVM games as a folder on the upload tab",
    homebrewFolder: "Upload homebrew that runs from a folder on the upload tab",
    patch: "Upload patches and saves on the upload tab",
    missingPart: "A file the list file names is not in the drop box",
    unknown: "Where this file goes is not known",
  },
  ja: {
    noSystem: "機種フォルダーに入れると移します。incoming の中に機種名のフォルダー (snes、gba、ps1 など) を作って入れます",
    noSystemHint: "機種フォルダーに入れると移します。incoming の中に機種名のフォルダー (snes、gba、ps1 など) を作って入れます。{system} の ROM のようです",
    wrongExtension: "この機種では使わない拡張子のため、移しませんでした。機種フォルダーが正しいか確認します",
    wrongExtensionHint: "この機種では使わない拡張子のため、移しませんでした。機種フォルダーが正しいか確認します。{system} の ROM のようです",
    scummvm: "ScummVM のゲームはアップロードタブでフォルダーごとアップロードします",
    homebrewFolder: "フォルダーごと使う自作アプリはアップロードタブでアップロードします",
    patch: "パッチとセーブはアップロードタブでアップロードします",
    missingPart: "一覧ファイルが指すファイルが一時フォルダーにありません",
    unknown: "どこに送るか分からないファイルです",
  },
  zh: {
    noSystem: "放入机种文件夹后才会移动。请在 incoming 中建立以机种命名的文件夹 (snes、gba、ps1 等) 并放入",
    noSystemHint: "放入机种文件夹后才会移动。请在 incoming 中建立以机种命名的文件夹 (snes、gba、ps1 等) 并放入。看起来是 {system} ROM",
    wrongExtension: "此机种不使用这个扩展名，因此没有移动。请确认机种文件夹是否正确",
    wrongExtensionHint: "此机种不使用这个扩展名，因此没有移动。请确认机种文件夹是否正确。看起来是 {system} ROM",
    scummvm: "ScummVM 游戏请在上传标签页按文件夹上传",
    homebrewFolder: "按文件夹运行的自制程序请在上传标签页上传",
    patch: "补丁和存档请在上传标签页上传",
    missingPart: "列表文件指向的文件不在临时文件夹中",
    unknown: "不知道该把这个文件放到哪里",
  },
});

/** The English text of each reason, by code. */
export const EXTRA_REASONS = Object.freeze({ ...EXTRA_REASON_TEXT.en });

/**
 * A held file: its reason as a code, in English as `reason`, and `vars` the panel fills in its own
 * language ({ system: the console's names per language }). Pure.
 */
function heldExtra(rel, code, vars = null, extra = {}) {
  const text = EXTRA_REASONS[code].replace(/\{system\}/g, () => vars?.system?.en ?? "");
  return { rel, code, reason: text, ...(vars ? { vars } : {}), ...extra };
}

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
    if (top === "atmosphere" || rel.toLowerCase().includes("/atmosphere/")) { held.push(heldExtra(rel, "patch")); continue; }
    if (ext === ".nro") {
      // A .nro with other files beside it is a folder app (a port and its data).
      const beside = (byDir.get(path.posix.dirname(rel)) ?? []).filter((r) => r !== rel);
      const folder = setFolderOf(name);
      if (beside.length && path.posix.dirname(rel) !== ".") { held.push(heldExtra(rel, "homebrewFolder")); continue; }
      if (!folder) { held.push(heldExtra(rel, "unknown")); continue; }
      moves.push({ from: rel, root: "homebrew", to: `${folder}/${name}` });
      continue;
    }
    if (ext === ".scummvm") { held.push(heldExtra(rel, "scummvm")); continue; }
    const system = systemFromFolders(rel, systems);
    const romLike = LISTS.has(ext) || Object.values(systems).some((s) => s.extensions.includes(ext));
    // What the extension alone suggests, said in the warning and never acted on.
    const hint = NO_HINT.has(ext) ? null : systemOfExtension(ext, systems);
    const looks = hint && hint !== system ? { system: { ...systems[hint].names, en: systems[hint].names?.en ?? hint } } : null;
    // A ROM-like file is held with what is wrong and, when the extension suggests another console, which one.
    const romHeld = (code) => (!romLike ? heldExtra(rel, "unknown", null, { system, hint }) : looks ? heldExtra(rel, `${code}Hint`, looks, { system, hint }) : heldExtra(rel, code, null, { system, hint }));
    if (!system) {
      held.push(romHeld("noSystem"));
      continue;
    }
    if (!systems[system].extensions.includes(ext) && !LISTS.has(ext)) {
      held.push(romHeld("wrongExtension"));
      continue;
    }
    const base = systems[system].folder;
    if (refs.has(rel)) {
      const parts = refs.get(rel);
      if (parts.some((p) => !rels.has(p))) { held.push(heldExtra(rel, "missingPart", null, { system })); continue; }
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
