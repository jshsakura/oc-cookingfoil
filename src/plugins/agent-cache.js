/**
 * What the metadata plugins said about each title, kept so a screen reads it without calling a plugin.
 *
 *   data/plugin-cache/<plugin>/agent/<title id>.json    { at, miss?, fields, credit? }
 *
 * It lives inside the plugin's own cache folder, so the plugin's cap (plugins/cache.js) bounds it and
 * "empty the cache" removes it. The key is the title id alone, never a file, so a title that is not in the
 * library (a wish, a recommendation, a search result) can be filled in the same way.
 *
 *   createAgentCache({ cacheDirOf, now?, ttl? }) -> { load, get, fresh, put, forget, forgetAll, count }
 *
 * get() answers from memory, so merging a field is synchronous and never touches the disk. load(id) reads
 * the plugin's folder once (the runner calls it before the first job); until then get() has nothing.
 * A miss ("the plugin knows nothing of this title") is kept too, for a shorter time, so a title no plugin
 * knows is not asked about again at every library scan.
 */
import fsp from "node:fs/promises";
import path from "node:path";

export const HIT_TTL_MS = 30 * 24 * 3600_000;
export const MISS_TTL_MS = 7 * 24 * 3600_000;
export const TITLE_ID_RE = /^[0-9A-Fa-f]{16}$/;
const DIR = "agent";

export function createAgentCache({ cacheDirOf, now = Date.now, ttl = { hit: HIT_TTL_MS, miss: MISS_TTL_MS } }) {
  const memory = new Map();
  const dirOf = (id) => path.join(cacheDirOf(id), DIR);
  const keyOf = (titleId) => String(titleId).toUpperCase();

  async function load(id) {
    if (memory.has(id)) return memory.get(id);
    const map = new Map();
    memory.set(id, map);
    let names = [];
    try { names = await fsp.readdir(dirOf(id)); } catch { /* no folder yet */ }
    for (const name of names) {
      const key = name.slice(0, -5);
      if (!name.endsWith(".json") || !TITLE_ID_RE.test(key)) continue;
      try {
        const entry = JSON.parse(await fsp.readFile(path.join(dirOf(id), name), "utf8"));
        if (entry && typeof entry.at === "number" && entry.fields && typeof entry.fields === "object") map.set(key, entry);
      } catch { /* a half-written or foreign file is not an entry */ }
    }
    return map;
  }

  const get = (id, titleId) => memory.get(id)?.get(keyOf(titleId)) ?? null;

  const fresh = (entry) => Boolean(entry) && now() - entry.at < (entry.miss ? ttl.miss : ttl.hit);

  async function put(id, titleId, answer) {
    const entry = { at: now(), ...(Object.keys(answer.fields).length ? { fields: answer.fields, ...(answer.credit ? { credit: answer.credit } : {}) } : { miss: true, fields: {} }) };
    const key = keyOf(titleId);
    const file = path.join(dirOf(id), `${key}.json`);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const tmp = path.join(path.dirname(file), `.${key}.${process.pid}.tmp`);
    await fsp.writeFile(tmp, JSON.stringify(entry));
    await fsp.rename(tmp, file);
    (memory.get(id) ?? memory.set(id, new Map()).get(id)).set(key, entry);
    return entry;
  }

  /** The plugin's values are gone from disk (or are about to be): forget them in memory. With `remove`, delete the files too. */
  async function forget(id, { remove = false } = {}) {
    memory.delete(id);
    if (remove) await fsp.rm(dirOf(id), { recursive: true, force: true });
  }

  const count = (id) => [...(memory.get(id)?.values() ?? [])].filter((e) => !e.miss).length;

  return { load, get, fresh, put, forget, count, dirOf };
}
