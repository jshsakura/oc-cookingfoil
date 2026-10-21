/**
 * The library tab's file browser, also meant for automation tokens:
 *
 *   GET /admin/api/library/browse?kind=&q=&ext=&minSize=&maxSize=&modifiedSince=&integrity=
 *                                &sort=&order=&page=&perPage=&fields=&counts_only=
 *     { items: [{ name, kind, rel, size, mtime, ext, titleId, game, version, integrity }],
 *       total, page, perPage, pages, sort, order, counts: { base, update, dlc, patch, save, homebrew, other } }
 *     counts_only=1 → { counts, total }
 *     "pending": true → the stray-file ("other") scan of a big folder has not finished its first pass; ask again shortly
 *     a wrong parameter → 400 { error, code: "bad-param", param }
 *
 * Read only. The item shape and the parameters are in meta/library-browse.js.
 * `rel` is relative to the kind's own folder (games, patches, saves, homebrew).
 */
import * as shopCache from "../../meta/shop-cache.js";
import * as userPatches from "../../meta/user-patches.js";
import * as titledb from "../../meta/titledb-store.js";
import { savesCatalog, savesEnabled } from "../saves.js";
import { defaultService as homebrewService } from "../homebrew.js";
import { installPathFor } from "../../meta/homebrew.js";
import verifyQueue from "../../meta/verify-service.js";
import { romsDirPath, patchesDir, savesDir, homebrewDir, retroDir, dataDir, incomingDir, incomingInGames } from "../../helpers/envs.js";
import {
  BadParam, browse, createOtherScanner, gameItem, item, nestedDirs, parseQuery,
} from "../../meta/library-browse.js";
import debug from "../../debug.js";

const OTHER_TTL_MS = 60_000;

/**
 * The name of the game a patch or save is for: titledb's Korean name first, then English,
 * then the name the library's own base file gives it. A patch made for an update keeps its base id.
 */
export function gameNameOf(titleId, libraryNames = new Map()) {
  const id = String(titleId ?? "").toUpperCase();
  if (!/^[0-9A-F]{16}$/.test(id)) return null;
  const base = id.slice(0, 13) + "000";
  for (const tid of id === base ? [id] : [id, base]) {
    const names = titledb.namesOf(tid);
    const name = names?.ko || names?.en || titledb.get(tid)?.name || libraryNames.get(tid);
    if (name) return name;
  }
  return null;
}

const libraryNames = () => new Map(shopCache.files().filter((f) => f.titleId && f.kind !== "update" && f.kind !== "dlc").map((f) => [String(f.titleId).toUpperCase(), f.name]));

/** The server's own listings, each in the browser's item shape. */
export function defaultSources({ verify = verifyQueue } = {}) {
  const verdictOf = (rel) => {
    const v = verify.get?.(rel)?.verdict;
    return v && v !== "unchecked" ? v : null;
  };
  return {
    async games() {
      await shopCache.get();
      return shopCache.files().map((f) => gameItem(f, verdictOf));
    },
    async patches() {
      const names = libraryNames();
      // A homebrew app's patch has no title id; its app's name says what it is for.
      const apps = new Map((await homebrewService.list()).filter((e) => e.install_type !== "title")
        .map((e) => [(e.install_path ?? installPathFor(e.file_name)).split("/")[1], e.name]));
      return (await userPatches.list()).map((p) => {
        const where = userPatches.locate(p.id);
        return item("patch", {
          name: p.name, rel: where ? `${where.dir}/${where.folder}` : null, size: p.size, mtime: p.updated_at,
          titleId: p.title_id ?? null, game: p.homebrew ? apps.get(p.homebrew) ?? p.homebrew : gameNameOf(p.title_id, names), version: p.version ?? null, id: p.id,
        });
      });
    },
    async saves() {
      if (!savesEnabled()) return [];
      const catalog = savesCatalog();
      const names = libraryNames();
      const out = [];
      for (const s of await catalog.list()) {
        const where = await catalog.locate(s.id);
        out.push(item("save", {
          name: s.name, rel: where ? `${where.dir}/${where.folder}` : null, size: s.size, mtime: s.updatedAt,
          titleId: s.titleId ?? null, game: gameNameOf(s.titleId, names), version: s.gameVersion ?? null, id: s.id,
        }));
      }
      return out;
    },
    async homebrew() {
      return (await homebrewService.list()).map((e) => {
        const when = Date.parse(e.updated_at ?? e.released_at ?? "");
        return item("homebrew", {
          name: e.name, rel: e.install_dir ?? e.install_path ?? e.file_name ?? null, size: e.size,
          mtime: Number.isFinite(when) ? when / 1000 : null, titleId: e.title_id ?? null, version: e.version ?? null,
          id: e.id, source: e.source ?? null, repo: String(e.repo_url ?? "").replace(/^https:\/\/github\.com\//, "") || null,
        });
      });
    },
  };
}

export function mountLibraryBrowseApi(router, requireSession, {
  sources = defaultSources(),
  other = createOtherScanner({ root: romsDirPath, ignore: [...new Set([...nestedDirs(romsDirPath, [patchesDir, savesDir, homebrewDir, retroDir, dataDir, incomingDir]), ...(incomingInGames ? [incomingInGames] : [])])], ttlMs: OTHER_TTL_MS }),
  onLibraryUpdate = shopCache.onUpdate,
} = {}) {
  // A rescan of the library also looks again for stray files.
  onLibraryUpdate?.(() => other.invalidate());

  // One listing failing (a folder that is gone, say) leaves the others standing.
  const safely = (label, fn) => fn().catch((err) => {
    debug.error("admin: library browse: %s: %s", label, err.message);
    return [];
  });

  async function everything() {
    let pending = false;
    const [games, patches, saves, homebrew, others] = await Promise.all([
      safely("games", () => sources.games()),
      safely("patches", () => sources.patches()),
      safely("saves", () => sources.saves()),
      safely("homebrew", () => sources.homebrew()),
      safely("other", async () => {
        // Walking the whole folder takes a while on a big library, so a request never waits for it.
        const found = other.peek ? other.peek() : await other.list();
        if (!found) pending = true;
        return (found ?? []).map((f) => item("other", f));
      }),
    ]);
    return { items: [...games, ...patches, ...saves, ...homebrew, ...others], pending };
  }

  router.get("/api/library/browse", async (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store");
    let query;
    try {
      query = parseQuery(req.query);
    } catch (err) {
      if (err instanceof BadParam) return res.status(400).json({ error: err.message, code: err.code, param: err.param });
      throw err;
    }
    try {
      const { items, pending } = await everything();
      res.json(pending ? { ...browse(items, query), pending: true } : browse(items, query));
    } catch (err) {
      debug.error("admin: library browse: %s", err.message);
      res.status(500).json({ error: "처리하지 못했습니다. 서버 기록을 봅니다", code: "failed" });
    }
  });
}
