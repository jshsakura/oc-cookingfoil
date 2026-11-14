/**
 * A Vita taiHEN plugin placed by hand: a homebrew folder whose .cookingfoil.json says platform "vita" and kind
 * "plugin", holding one .suprx or .skprx. What the manifest says goes to Vita consoles only, so every value is
 * checked here and a folder with one it cannot vouch for is left out: the console writes the file to
 * install_path and adds it under each of sections in its tai config.txt.
 *
 *   { "platform": "vita", "kind": "plugin", "file": "x.suprx", "sections": ["*main"], "name": "…",
 *     "description": "…", "install_path": "ur0:tai/x.suprx", "kernel": false, "required": true,
 *     "display_version": "2.1.0", "source_url": "https://…" }
 */

// A plain name, no folder: the file sits beside its manifest.
const FILE_RE = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}\.(suprx|skprx)$/i;
// Under ur0:tai/ or ux0:tai/ only; no segment starts with a dot, so none is "..".
const INSTALL_RE = /^(ur0|ux0):tai\/(?:[A-Za-z0-9_-][A-Za-z0-9._-]{0,63}\/){0,3}[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}\.(suprx|skprx)$/i;
// A config.txt section: *KERNEL, *main, *NPXS10015, *ALL, a title id.
const SECTION_RE = /^\*[A-Za-z0-9_]{1,32}$/;
const MAX_SECTIONS = 16;

const text = (v, max) => (typeof v === "string" && v.trim() && v.trim().length <= max && !/\p{Cc}/u.test(v.trim()) ? v.trim() : null);
const httpUrl = (v) => {
  const s = text(v, 512);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
};

/**
 * The plugin a manifest describes, given the names in its folder: { file, sections, install_path, kernel, required,
 * name, description, display_version, source_url }, or { error } naming what is wrong. Pure.
 */
export function readPluginManifest(manifest, names) {
  const file = manifest?.file;
  if (typeof file !== "string" || !FILE_RE.test(file) || !names.includes(file)) return { error: "file" };
  const sections = manifest.sections;
  if (!Array.isArray(sections) || !sections.length || sections.length > MAX_SECTIONS
    || !sections.every((s) => typeof s === "string" && SECTION_RE.test(s)) || new Set(sections).size !== sections.length) return { error: "sections" };
  const installPath = manifest.install_path ?? `ur0:tai/${file}`;
  if (typeof installPath !== "string" || !INSTALL_RE.test(installPath)) return { error: "install_path" };
  if (extOf(installPath) !== extOf(file)) return { error: "install_path" };
  for (const flag of ["kernel", "required"]) if (manifest[flag] != null && typeof manifest[flag] !== "boolean") return { error: flag };
  return {
    file,
    sections: [...sections],
    install_path: installPath,
    kernel: manifest.kernel ?? extOf(file) === "skprx",
    required: manifest.required ?? false,
    name: text(manifest.name, 80),
    description: text(manifest.description, 1000),
    display_version: text(manifest.display_version, 32),
    source_url: httpUrl(manifest.source_url),
  };
}

function extOf(name) {
  return name.slice(name.lastIndexOf(".") + 1).toLowerCase();
}
