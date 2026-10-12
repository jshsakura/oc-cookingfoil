/**
 * What the admin upload box was handed, read from the file names alone so the
 * admin only drops files and checks the guess. Pure and self-contained: the
 * dashboard inlines it with Function#toString, so it uses nothing outside.
 *
 *   names     the dropped files' names
 *   paths     their paths inside a dropped or picked folder, else null
 *   zipNames  the entries of a lone .zip, null when there is no zip or it can't be read
 *   systems   [{ id, extensions }] the retro consoles the server knows
 *
 * → { kind: game|retro|patch|save|homebrew|null, systems?, titleId?, name? }
 *   kind null means the files did not say; the admin picks it.
 */
export function guessUpload({ names, paths = null, zipNames = null, systems = [] }) {
  const ext = (n) => { const i = n.lastIndexOf("."); return i > 0 ? n.slice(i).toLowerCase() : ""; };
  const stem = (n) => { const b = n.split("/").filter(Boolean)[0] ?? n; const i = b.lastIndexOf("."); return i > 0 && !paths ? b.slice(0, i) : b; };
  if (!names.length) return { kind: null };
  const exts = names.map(ext);
  if (!paths && exts.every((e) => [".nsp", ".nsz", ".xci", ".xcz"].includes(e))) return { kind: "game" };
  if (!paths && names.length === 1 && exts[0] === ".nro") return { kind: "homebrew" };

  const inside = paths ?? (names.length === 1 && exts[0] === ".zip" ? zipNames : null);
  if (inside) {
    const name = stem(paths ? paths[0] : names[0]);
    for (const p of inside) {
      const m = /(?:^|\/)atmosphere\/contents\/([0-9a-fA-F]{16})\//.exec(p);
      if (m) {
        const tid = m[1].toUpperCase();
        // A patch is listed under its game's base title id (the low 13 bits cleared).
        const base = tid.slice(0, 12) + (parseInt(tid[12], 16) & 0xe).toString(16).toUpperCase() + "000";
        return { kind: "patch", titleId: base, name };
      }
    }
    if (inside.some((p) => ext(p) === ".nro")) return { kind: "homebrew", name };
    if (paths) return { kind: "save", name };
    // A zipped ROM: consoles that take .zip and the ROM inside it.
    const roms = inside.filter((p) => !p.endsWith("/")).map(ext);
    const zipped = systems.filter((s) => s.extensions.includes(".zip") && roms.length && roms.every((e) => s.extensions.includes(e))).map((s) => s.id);
    if (zipped.length) return { kind: "retro", systems: zipped };
    return { kind: null, name };
  }

  // Retro: the consoles that play the first file that isn't a companion (.cue/.m3u and the like).
  const companions = [".cue", ".m3u", ".bin", ".img", ".sub", ".ccd", ".gdi", ".raw"];
  const rom = exts.find((e) => !companions.includes(e)) ?? exts[0];
  const fits = systems.filter((s) => s.extensions.includes(rom)).map((s) => s.id);
  if (fits.length) return { kind: "retro", systems: fits };
  return { kind: null };
}
