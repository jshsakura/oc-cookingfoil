/**
 * What the library knows about the entries of a file listing (admin file browser):
 *   titleLabel(lang)(name)      the game a title id at the start of a name stands for (saves, patches folders)
 *   createFileFacts()(key, items, lang)  each item with { titleId, kind, version, latest, check, why } where known:
 *     titleId  the base game, for its icon: a scanned game file's, the first one under a games folder's,
 *              or the one a name starts with
 *     kind     "base" | "update" | "dlc" for a scanned game file, version its version
 *     latest   an update: whether it is the newest titledb knows (null when titledb does not say)
 *     check    "damaged" | "modified" when the integrity check found the file so
 *     why      that finding's label, whether the install surely fails, and its help, in `lang`
 * Pure over the library cache, the integrity findings and titledb; nothing is read from disk.
 */
import * as libraryCache from "../meta/library-cache.js";
import { findingOf } from "../meta/file-integrity.js";
import { explain } from "../meta/integrity-help.js";
import { latestVersion } from "../meta/titledb-versions.js";
import { baseTitleIdOf } from "../meta/image-cache.js";
import { namesOf } from "../meta/titledb-store.js";

const TITLE_ID_RE = /^([0-9a-f]{16})(?=$|[ ._\-[(])/i;
const CHECKS = new Set(["damaged", "modified"]);

/** The title id a name starts with, upper case, or null. */
export const titleIdIn = (name) => TITLE_ID_RE.exec(name)?.[1].toUpperCase() ?? null;

/** label(name) for one language: the game a title id names, an update or DLC falling back to its base game. */
export function titleLabel(lang, names = namesOf) {
  const memo = new Map();
  return (name) => {
    const id = titleIdIn(name);
    if (!id) return null;
    if (!memo.has(id)) {
      const all = names(id) ?? names(baseTitleIdOf(id));
      memo.set(id, all ? (all[lang] ?? all.en ?? Object.values(all)[0] ?? null) : null);
    }
    return memo.get(id);
  };
}

export function createFileFacts({ files = libraryCache.files, integrity = findingOf, latest = latestVersion } = {}) {
  return (key, items, lang = "en") => {
    const byRel = new Map();
    const dirBase = new Map();
    if (key === "games") {
      for (const f of files()) {
        byRel.set(f.rel, f);
        const base = f.baseTitleId ?? (f.titleId ? baseTitleIdOf(f.titleId) : null);
        if (!base) continue;
        // Every folder above a file names that file's game, the first one found winning; once a folder has
        // one, the folders above it have one too.
        for (let at = f.rel; at.includes("/"); ) {
          at = at.slice(0, at.lastIndexOf("/"));
          if (dirBase.has(at)) break;
          dirBase.set(at, base);
        }
      }
    }
    return items.map((item) => {
      const f = byRel.get(item.rel);
      if (f) {
        const own = f.titleId ?? titleIdIn(item.name);
        const base = f.baseTitleId ?? (own ? baseTitleIdOf(own) : null);
        const newest = f.kind === "update" && base ? latest(base) : null;
        const finding = integrity(item.rel);
        const check = CHECKS.has(finding?.verdict) ? finding.verdict : null;
        return {
          ...item, titleId: base, kind: f.kind ?? null, version: f.version ?? null,
          latest: newest != null && f.version != null ? f.version >= newest : null,
          check, ...(check ? { why: explain(finding, lang) } : {}),
        };
      }
      const named = titleIdIn(item.name);
      const base = item.type === "dir" && dirBase.get(item.rel) ? dirBase.get(item.rel) : named ? baseTitleIdOf(named) : null;
      return base ? { ...item, titleId: base } : item;
    });
  };
}
