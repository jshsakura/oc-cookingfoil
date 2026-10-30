/**
 * The folder-shaped things in the drop box (library-organize.js): what each folder is, from the files in it.
 *
 *   patch     files under atmosphere/contents/<title id>/, in a folder whose name becomes the patch's name
 *   homebrew  a folder holding a .nro: an app that runs from its folder (a port and its data)
 *   scummvm   a folder holding a <name>.scummvm file: the whole folder goes to the console's folder
 *   save      a folder named after a title id: a save needs the game picked, so it stays
 *
 * Patches and homebrew are placed by the upload page's own code (folder-place.js, homebrew-upload.js); a
 * ScummVM game is plain moves. Pure.
 */
import path from "node:path";
import { systemOfFolder } from "../retro/systems.js";
import { cleanStem } from "./incoming-extras.js";

const HEX16 = /^[0-9a-f]{16}$/i;

/**
 * { groups, moves, held, rest } for `items` ([{ rel }]). `groups` is [{ kind: "patch" | "homebrew", root, files:
 * [{ rel, inner }], body }] with `inner` relative to the group's folder; `moves` are ScummVM moves like
 * planExtras'; `held` are { rel, code }; `rest` are the items that are none of these. Pure.
 */
export function planFolders(items, systems) {
  const groups = [];
  const moves = [];
  const held = [];
  const taken = new Set();
  const rels = items.map((i) => i.rel);

  // Patches: the folder above atmosphere/ names the patch.
  const patchRoots = new Map();
  for (const rel of rels) {
    const at = rel.toLowerCase().indexOf("atmosphere/contents/");
    if (at < 0 || (at > 0 && rel[at - 1] !== "/")) continue;
    const root = rel.slice(0, at);
    patchRoots.set(root, [...(patchRoots.get(root) ?? []), rel]);
  }
  for (const [root, files] of patchRoots) {
    const name = root ? cleanStem(path.posix.basename(root)) : null;
    if (!name) { for (const rel of files) { held.push({ rel, code: "patchName" }); taken.add(rel); } continue; }
    const all = rels.filter((r) => r.startsWith(root));
    for (const rel of all) taken.add(rel);
    groups.push({ kind: "patch", root, files: all.map((rel) => ({ rel, inner: rel.slice(root.length) })), body: { name } });
  }

  // ScummVM games: the folder with the .scummvm file in it.
  for (const rel of rels) {
    if (taken.has(rel) || !/\.scummvm$/i.test(rel) || !rel.includes("/")) continue;
    const dir = path.posix.dirname(rel);
    const folder = systems.scummvm?.folder;
    const top = dir.split("/")[0];
    if (!folder || systemOfFolder(top, systems)) continue;
    for (const r of rels.filter((x) => x.startsWith(`${dir}/`) && !taken.has(x))) {
      taken.add(r);
      moves.push({ from: r, root: "retro", to: `roms/${folder}/${path.posix.basename(dir)}/${r.slice(dir.length + 1)}`, system: "scummvm", by: "folder" });
    }
  }

  // Apps that run from their folder, and saves named after a game.
  const tops = new Map();
  for (const rel of rels) {
    if (taken.has(rel) || !rel.includes("/")) continue;
    const top = rel.split("/")[0];
    tops.set(top, [...(tops.get(top) ?? []), rel]);
  }
  for (const [top, files] of tops) {
    if (systemOfFolder(top, systems)) continue; // a console folder, not an app
    if (HEX16.test(top)) { for (const rel of files) held.push({ rel, code: "save" }); files.forEach((f) => taken.add(f)); continue; }
    if (!files.some((r) => /\.nro$/i.test(r))) continue;
    files.forEach((f) => taken.add(f));
    groups.push({ kind: "homebrew", root: `${top}/`, files: files.map((rel) => ({ rel, inner: rel.slice(top.length + 1) })), body: {} });
  }
  return { groups, moves, held, rest: items.filter((i) => !taken.has(i.rel)) };
}
