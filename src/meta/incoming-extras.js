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
import { PLAYSTATION_UNPLAYABLE } from "./drop-sniff.js";

// Too common to hint at a system: a picture is rarely a PICO-8 cart.
// Extensions that name a console only when the file's bytes agree: a picture, someone's notes.
const BY_CONTENT = new Set([".png", ".md"]);
const LISTS = new Set([".cue", ".m3u"]);

// Why a file other than a Switch package stays in the drop box, by code, in each admin page language.
// library-organize.js merges these into its REASON_TEXT, so the panel says them like its own.
export const EXTRA_REASON_TEXT = Object.freeze({
  ko: {
    noSystem: "기종 폴더에 넣어야 옮깁니다. incoming 안에 기종 이름 폴더(snes, gba, ps1 등)를 만들어 넣습니다",
    wrongExtension: "이 기종에서 쓰지 않는 확장자라 옮기지 않았습니다. 기종 폴더가 맞는지 확인합니다",
    scummvm: "ScummVM 게임은 폴더째 업로드 탭에서 올립니다",
    homebrewFolder: "폴더째 쓰는 홈브류는 업로드 탭에서 올립니다",
    patch: "패치와 세이브는 업로드 탭에서 올립니다",
    missingPart: "목록 파일이 가리키는 파일이 임시 폴더에 없습니다",
    psUnsure: "PlayStation 디스크 이미지인데 PS1 인지 PS2 인지 알 수 없어 옮기지 않았습니다. 해시 목록에도 없습니다",
    ps2: "PS2 게임은 스위치에서 돌릴 수 없어 옮기지 않았습니다",
    unknown: "어디로 보낼지 모르는 파일입니다",
  },
  en: {
    noSystem: "It moves once it is in a console folder. Make a folder named after the console (snes, gba, ps1 and so on) inside incoming and put it there",
    wrongExtension: "This console does not use this extension, so it was not moved. Check that the console folder is right",
    scummvm: "Upload ScummVM games as a folder on the upload tab",
    homebrewFolder: "Upload homebrew that runs from a folder on the upload tab",
    patch: "Upload patches and saves on the upload tab",
    missingPart: "A file the list file names is not in the drop box",
    psUnsure: "This PLAYSTATION disc image cannot be told from a PS2 one, and no hash list has it, so it was not moved",
    ps2: "PS2 games do not run on the Switch, so this was not moved",
    unknown: "Where this file goes is not known",
  },
  ja: {
    noSystem: "機種フォルダーに入れると移します。incoming の中に機種名のフォルダー (snes、gba、ps1 など) を作って入れます",
    wrongExtension: "この機種では使わない拡張子のため、移しませんでした。機種フォルダーが正しいか確認します",
    scummvm: "ScummVM のゲームはアップロードタブでフォルダーごとアップロードします",
    homebrewFolder: "フォルダーごと使う自作アプリはアップロードタブでアップロードします",
    patch: "パッチとセーブはアップロードタブでアップロードします",
    missingPart: "一覧ファイルが指すファイルが一時フォルダーにありません",
    psUnsure: "PlayStationのディスクイメージですがPS1かPS2か分からず、ハッシュリストにもないため移しませんでした",
    ps2: "PS2のゲームはSwitchで動かせないため移しませんでした",
    unknown: "どこに送るか分からないファイルです",
  },
  zh: {
    noSystem: "放入机种文件夹后才会移动。请在 incoming 中建立以机种命名的文件夹 (snes、gba、ps1 等) 并放入",
    wrongExtension: "此机种不使用这个扩展名，因此没有移动。请确认机种文件夹是否正确",
    scummvm: "ScummVM 游戏请在上传标签页按文件夹上传",
    homebrewFolder: "按文件夹运行的自制程序请在上传标签页上传",
    patch: "补丁和存档请在上传标签页上传",
    missingPart: "列表文件指向的文件不在临时文件夹中",
    psUnsure: "这是 PlayStation 光盘镜像，无法分辨是 PS1 还是 PS2，哈希列表中也没有，因此没有移动",
    ps2: "PS2 游戏无法在 Switch 上运行，因此没有移动",
    unknown: "不知道该把这个文件放到哪里",
  },
});

/** The English text of each reason, by code. */
export const EXTRA_REASONS = Object.freeze({ ...EXTRA_REASON_TEXT.en });

/** A held file: its reason as a code and in English as `reason`. Pure. */
const heldExtra = (rel, code, extra = {}) => ({ rel, code, reason: EXTRA_REASONS[code], ...extra });

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

/** A file or folder name from a game's list name (and its Korean name); null when nothing is left. Pure. */
export function cleanStem(text) {
  const out = String(text ?? "").normalize("NFC").replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g, "").replace(/\s+/g, " ").replace(/^[\s.]+|[\s.]+$/g, "").slice(0, 150).trim();
  return out || null;
}

const DISC_RE = /\s*\(Disc (\d+)\)/;

/** The name a hash-confirmed dump is filed under: "한글명 (English)" when the Korean name is known, else the list's name. Pure. */
export const dumpStem = (dump) => cleanStem(dump.ko && dump.ko !== dump.name ? `${dump.ko} (${dump.name})` : dump.name);

/**
 * The plan for the drop box's other files. `items` is [{ rel }] (settled, not
 * Switch packages), `refs` maps a .cue/.m3u rel to the rels it names (resolved
 * inside the drop box), `sniffed` maps a rel to the console its bytes name (drop-sniff.js),
 * `identified` maps a rel to the dump a hash database lists for it, { systems, name, ko? } (drop-hash.js),
 * `systems` is loadSystems(). Moves are
 * { from, root: "retro" | "homebrew", to, system? }; `to` is relative to that root. A file whose dump is listed
 * is filed under the list's name, and a game whose discs are all in the drop box goes into one folder with an
 * .m3u made for it: `writes` is [{ root, to, content, after }] (files to make once every `after` target is in place). Pure.
 */
export function planExtras({ items = [], refs = new Map(), sniffed = new Map(), identified = new Map(), systems = {} }) {
  const moves = [];
  const held = [];
  const writes = [];
  const rels = new Set(items.map((i) => i.rel));
  const claimed = new Set();
  for (const parts of refs.values()) for (const p of parts) claimed.add(p);
  const byDir = new Map();
  for (const { rel } of items) {
    const d = path.posix.dirname(rel);
    byDir.set(d, [...(byDir.get(d) ?? []), rel]);
  }

  const decide = (rel) => {
    const ext = path.posix.extname(rel).toLowerCase();
    const sole = LISTS.has(ext) || BY_CONTENT.has(ext) ? null : systemOfExtension(ext, systems);
    const bytes = systems[sniffed.get(rel)] ? sniffed.get(rel) : null;
    const guessed = sole ?? bytes ?? systemFromFolders(rel, systems);
    const dump = identified.get(rel);
    const listed = dump?.systems.length === 1 ? dump.systems[0] : dump?.systems.includes(guessed) ? guessed : null;
    return { sole, dump, listed, system: listed ?? guessed, by: listed ? "hash" : sole ? "extension" : bytes ? "bytes" : "folder" };
  };
  // Games whose discs are all here: "Name (Disc 1)", "Name (Disc 2)" of one console.
  const discs = new Map();
  for (const { rel } of items) {
    if (claimed.has(rel) && !refs.has(rel)) continue;
    const { dump, listed } = decide(rel);
    const n = dump && listed && listed !== "arcade" ? DISC_RE.exec(dump.name) : null;
    if (!n) continue;
    const key = `${listed}|${dump.name.replace(DISC_RE, "")}`;
    discs.set(key, [...(discs.get(key) ?? []), { rel, n: Number(n[1]) }]);
  }
  const multi = new Map(); // rel → { set, order, system }
  for (const [key, list] of discs) {
    if (new Set(list.map((d) => d.n)).size < 2) continue;
    const set = cleanStem(key.slice(key.indexOf("|") + 1));
    if (!set) continue;
    const system = key.slice(0, key.indexOf("|"));
    for (const d of list) multi.set(d.rel, { set, system, n: d.n, key });
  }
  const m3us = new Map(); // key → { root path, lines: [{ n, name, after }] }

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
    // A listed dump names its console first; then an extension only one console uses, what the bytes say, and the folder the file sits in.
    const { dump, listed, system, by } = decide(rel);
    const unplayable = PLAYSTATION_UNPLAYABLE[sniffed.get(rel)];
    if (unplayable && !listed) { held.push(heldExtra(rel, unplayable)); continue; }
    const romLike = LISTS.has(ext) || Object.values(systems).some((s) => s.extensions.includes(ext));
    const romHeld = (code) => heldExtra(rel, romLike ? code : "unknown", { system });
    if (!system) {
      held.push(romHeld("noSystem"));
      continue;
    }
    if (!systems[system].extensions.includes(ext) && !LISTS.has(ext)) {
      held.push(romHeld("wrongExtension"));
      continue;
    }
    const base = systems[system].folder;
    const stem = listed && listed !== "arcade" ? dumpStem(dump) : null;
    const tag = { system, by, ...(dump ? { dbName: dump.name } : {}) };
    const group = multi.get(rel);
    if (refs.has(rel)) {
      const parts = refs.get(rel);
      if (parts.some((p) => !rels.has(p))) { held.push(heldExtra(rel, "missingPart", { system })); continue; }
      const set = group?.set ?? stem ?? setFolderOf(name);
      const dir = path.posix.dirname(rel);
      const placed = [];
      for (const r of [rel, ...parts]) {
        const inner = dir === "." ? r : r.slice(dir.length + 1);
        placed.push(`roms/${base}/${set}/${inner}`);
        moves.push({ from: r, root: "retro", to: placed.at(-1), ...tag });
      }
      if (group) m3us.set(group.key, [...(m3us.get(group.key) ?? []), { n: group.n, name: placed[0].slice(`roms/${base}/${group.set}/`.length), after: placed }]);
      continue;
    }
    if (group) {
      const file = `${dumpStem(dump)}${ext}`;
      const to = `roms/${base}/${group.set}/${file}`;
      moves.push({ from: rel, root: "retro", to, ...tag });
      m3us.set(group.key, [...(m3us.get(group.key) ?? []), { n: group.n, name: file, after: [to] }]);
      continue;
    }
    moves.push({ from: rel, root: "retro", to: `roms/${base}/${stem ? `${stem}${ext}` : name}`, ...tag });
  }
  for (const [key, list] of m3us) {
    const { set, system } = multi.get([...multi].find(([, g]) => g.key === key)[0]);
    const ordered = [...list].sort((a, b) => a.n - b.n);
    writes.push({ root: "retro", to: `roms/${systems[system].folder}/${set}/${set}.m3u`, content: `${ordered.map((d) => d.name).join("\n")}\n`, after: ordered.flatMap((d) => d.after) });
  }
  return { moves, held, writes };
}
