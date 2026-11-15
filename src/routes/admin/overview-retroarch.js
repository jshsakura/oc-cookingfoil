/**
 * The PS Vita's RetroArch for the overview: the homebrew app whose .vpk carries the libretro cores
 * (`<core>_libretro.self`), as { name, version, size, cores, url } where `url` is the admin file download of the .vpk,
 * or null when the server holds none. The core count is read from the zip directory once per file state.
 */
import path from "path";
import { zipDirectory } from "../../helpers/zip-read.js";
import { homebrewDir } from "../../helpers/envs.js";

const CORE_RE = /_libretro\.self$/i;
const counted = new Map();

async function coresIn(abs, size) {
  const key = `${abs}\0${size}`;
  if (!counted.has(key)) counted.set(key, (await zipDirectory(abs).catch(() => [])).filter((e) => CORE_RE.test(e.name)).length);
  return counted.get(key);
}

/** `service` is the homebrew service (list, download). */
export async function vitaRetroArch(service) {
  const apps = await service.list();
  const app = apps.find((e) => e.install_type === "vpk" && /retroarch/i.test(e.name ?? ""));
  if (!app) return null;
  const file = await service.download(app.id).catch(() => null);
  if (!file?.path) return null;
  const rel = path.relative(homebrewDir, file.path);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return {
    name: app.name,
    version: app.display_version ?? app.version ?? null,
    size: app.size ?? null,
    cores: await coresIn(file.path, app.size ?? 0),
    url: `/admin/api/files/download?root=homebrew&path=${rel.split(path.sep).map(encodeURIComponent).join("/")}`,
  };
}
