/**
 * The games folder's drop box (meta/library-organize.js) on the admin page:
 *
 *   GET  /admin/api/library/organize        { incoming, sweptAt, error, running, held, heldCount, waiting, recent }
 *   POST /admin/api/library/organize/sweep  sort the drop box now; answers with the view after it
 */
import * as env from "../../helpers/envs.js";
import * as shopCache from "../../meta/shop-cache.js";
import * as titledb from "../../meta/titledb-store.js";
import * as activity from "../../tasks/activity.js";
import * as gameDescriptions from "../../meta/game-descriptions.js";
import * as extractedMeta from "../../meta/extracted-meta-store.js";
import { extractFromPfs0 } from "../../meta/extract-providers/nsp.js";
import { createOrganizer } from "../../meta/library-organize.js";
import { cleanName, nameIn } from "../../meta/organize-naming.js";
import { loadSystems } from "../../retro/systems.js";
import * as retroCatalog from "../../retro/catalog.js";
import { refreshManual } from "../homebrew.js";
import fsp from "fs/promises";
import path from "path";
import debug from "../../debug.js";

/**
 * The game's name from a file's NACP: the one already read for the game, else
 * the NACP cut out of an NSP or NSZ (a few MB of reads). An XCI or XCZ would
 * have to be unpacked whole, so it is not read here.
 */
async function readNacpName({ abs }, id) {
  const stored = extractedMeta.get(id.baseTitleId)?.name;
  if (cleanName(stored)) return stored;
  if (!/\.(nsp|nsz)$/i.test(abs)) return null;
  const read = await extractFromPfs0({ absPath: abs, baseTitleId: id.baseTitleId }, { langPriority: env.langPriority });
  return read?.name ?? null;
}

export const defaultOrganizer = createOrganizer({
  incomingDir: env.incomingDir,
  romsDir: env.romsDirPath,
  romsRels: async () => {
    await shopCache.get();
    return shopCache.files().map((f) => f.rel);
  },
  adminName: (tid) => nameIn(gameDescriptions.names(tid), env.langPriority),
  titledbName: (tid) => nameIn(titledb.namesOf(tid), env.langPriority) ?? titledb.get(tid)?.name ?? null,
  readNacpName,
  retroDir: env.retroDir,
  homebrewDir: env.homebrewDir,
  systems: () => loadSystems(env.retroDir),
  readRefs: async (abs) => retroCatalog.referencedFiles(path.extname(abs).toLowerCase(), await fsp.readFile(abs, "utf8")),
  begin: activity.begin,
  rescan: () => shopCache.invalidate({ rescan: true }),
  rescanRetro: () => retroCatalog.rescan(env.retroDir).catch((err) => debug.error("organize: retro rescan failed: %s", err.message)),
  rescanHomebrew: () => refreshManual().catch((err) => debug.error("organize: homebrew rescan failed: %s", err.message)),
});

export function mountLibraryOrganizeApi(router, requireSession, organizer = defaultOrganizer) {
  const handle = (fn) => async (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store");
    try {
      await fn(req, res);
    } catch (err) {
      debug.error("admin: organize: %s", err.message);
      res.status(500).json({ error: "처리하지 못했습니다. 서버 기록을 봅니다" });
    }
  };

  router.get("/api/library/organize", handle((req, res) => res.json(organizer.view())));

  router.post("/api/library/organize/sweep", handle(async (req, res) => {
    const { moved } = await organizer.sweep();
    debug.log("admin: organize: moved %d", moved);
    res.json({ moved, ...organizer.view() });
  }));
}
