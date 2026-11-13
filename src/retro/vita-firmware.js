/**
 * The firmware a Vita needs for the games it is shown (GET /api/retro/requirements): per system with a Vita
 * core, the files its core reads from RetroArch's system folder, as the Switch gets them in its pack. Where
 * the Vita puts them is the Vita's call; `path` is the place under system/. A required file the server lacks
 * is listed with no url. Only paths in this list can be downloaded (routes/retro.js), each with its md5.
 */
import fsp from "node:fs/promises";
import path from "node:path";
import { firmwareDir, listFirmware, md5Cache } from "./bios.js";
import { requirements } from "./requirements.js";

const lower = (s) => String(s).toLowerCase();
const PREFIX = "retroarch/system/";

/** { systems: [{ id, files: [{ path, size, md5, required, url }] }] } and the server file behind each path. */
export async function vitaFirmware({ games, systems, retroDir, packDir, link = (p) => p }) {
  const onVita = games.filter((g) => systems[g.system]?.cores?.vita);
  const dir = firmwareDir(retroDir);
  const files = await listFirmware(dir);
  const view = await requirements({ games: onVita, systems, packDir, firmwareDir: dir, files });
  const served = new Map();
  const present = async (rel, at, required) => {
    const full = path.join(dir, rel);
    const [st, md5] = await Promise.all([fsp.stat(full).catch(() => null), md5Cache.md5(full)]);
    if (!st?.isFile()) return null;
    served.set(at, full);
    return { path: at, size: st.size, md5, required, url: link(`/api/retro/requirements/file?path=${encodeURIComponent(at)}`) };
  };
  const out = [];
  for (const s of view.systems) {
    const list = [];
    for (const f of s.firmware) {
      if (f.state !== "missing" && f.file && f.console?.startsWith(PREFIX)) {
        const row = await present(f.file, f.console.slice(PREFIX.length), f.required);
        if (row) list.push(row);
      } else if (f.required) list.push({ path: f.files[0], size: null, md5: null, required: true, url: null });
    }
    for (const b of s.arcade?.bios ?? []) {
      const rel = files.find((f) => lower(path.basename(f)) === lower(b.zip) && ["", "fbneo"].includes(lower(path.dirname(f) === "." ? "" : path.dirname(f))));
      const row = rel && (await present(rel, rel, true));
      list.push(row ?? { path: `fbneo/${b.zip}`, size: null, md5: null, required: true, url: null });
    }
    if (list.length) out.push({ id: s.id, files: list });
  }
  return { body: { systems: out }, served };
}
