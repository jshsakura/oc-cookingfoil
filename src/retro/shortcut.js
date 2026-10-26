/**
 * What a HOME menu shortcut is called and what it starts. The console client builds the
 * shortcut itself (keys from the console, nothing is packed here); the server only says
 * which title ID a game or app's shortcut has, so a client can recognise one it installed.
 *
 * Title IDs are 05 + 44 bits of sha256(id) + 000: the same game always gets the same ID,
 * so reinstalling replaces the old shortcut.
 */
import crypto from "crypto";

/** The shortcut's title ID for a game or app id: 05, 44 hash bits, 000. Pure. */
export function shortcutTitleId(id) {
  const hash = crypto.createHash("sha256").update(String(id)).digest("hex");
  return `05${hash.slice(0, 11)}000`.toUpperCase();
}

/**
 * The name on the HOME menu: the Korean title of a "한글명 (English) [patch]"
 * file name, or the whole name without its tags when there's nothing before them. Pure.
 */
export function displayName(name) {
  const noTags = String(name).replace(/\s*\[[^\]]*\]\s*$/, "").trim();
  const beforeParen = noTags.replace(/\s*\((?:[^()]|\([^()]*\))*\)\s*$/, "").trim();
  return beforeParen || noTags || String(name);
}

/** The HOME menu name of a game's shortcut: its display name, then what tells it from its other versions. Pure. */
export const shortcutName = (game) => (game.versionLabel ? `${displayName(game.name)} · ${game.versionLabel}` : displayName(game.name));

/**
 * What a game's shortcut starts: the core NRO and argv with the ROM's SD path, or
 * null when the path can't be quoted safely. `romSdPath` is SD-relative
 * (the bundle's install.rom), so both always point at the same file. Pure.
 */
export function launchTarget(core, romSdPath) {
  if (!core || !romSdPath || /["\0\r\n]/.test(romSdPath) || romSdPath.startsWith("/") || romSdPath.split("/").includes("..")) return null;
  const nroPath = `sdmc:/retroarch/cores/${core}_libretro_libnx.nro`;
  return { nroPath, argv: `${nroPath} "sdmc:/${romSdPath}"` };
}

/**
 * What a homebrew app's shortcut starts: the .nro where the client keeps it,
 * sdmc:/switch/<name>/<name>.nro, or null for a file name that isn't plain. Pure.
 */
export function homebrewTarget(fileName, installPath = null) {
  if (/^switch\/[A-Za-z0-9_-][A-Za-z0-9_.-]*\/[A-Za-z0-9_-][A-Za-z0-9_.-]*\.nro$/i.test(String(installPath ?? ""))) {
    return { nroPath: `sdmc:/${installPath}`, argv: `sdmc:/${installPath}` };
  }
  if (!/^[A-Za-z0-9_.-]+\.nro$/i.test(String(fileName ?? "")) || fileName.startsWith(".")) return null;
  const nroPath = `sdmc:/switch/${fileName.replace(/\.nro$/i, "")}/${fileName}`;
  return { nroPath, argv: nroPath };
}

/**
 * What one game's shortcut is made of, or null when it can't have one.
 * `game` carries { id, name, core, romSdPath, artKey, publisher }, or a ready
 * `target` ({ nroPath, argv }) in place of core and romSdPath, and `cores`
 * (4 lets its threads use CPU core 3; anything else is the default 3).
 * `key` changes with the name, publisher, target, cover and cores: a client compares it
 * with the one it installed to see that its shortcut is out of date.
 */
export function shortcutSpec(game) {
  const target = game.target ?? launchTarget(game.core, game.romSdPath);
  if (!target) return null;
  const titleId = shortcutTitleId(game.id);
  const name = shortcutName(game);
  const cores = game.cores === 4 ? 4 : 3;
  const parts = [titleId, name, game.publisher, target, game.artKey ?? null, ...(cores === 4 ? [{ cores }] : [])];
  const key = crypto.createHash("sha1").update(JSON.stringify(parts)).digest("hex").slice(0, 12);
  return { titleId, name, publisher: game.publisher, target, key, cores };
}
