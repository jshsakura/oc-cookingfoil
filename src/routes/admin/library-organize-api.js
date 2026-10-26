/**
 * The games folder's drop box (meta/library-organize.js) on the admin page:
 *
 *   GET  /admin/api/library/organize        { incoming, sweptAt, error, running, held, heldCount, waiting, recent }
 *   POST /admin/api/library/organize/sweep  sort the drop box now; answers with the view after it
 */
import * as env from "../../helpers/envs.js";
import * as libraryCache from "../../meta/library-cache.js";
import * as titledb from "../../meta/titledb-store.js";
import * as activity from "../../tasks/activity.js";
import * as gameDescriptions from "../../meta/game-descriptions.js";
import * as extractedMeta from "../../meta/extracted-meta-store.js";
import { extractFromPfs0, resolveBinary } from "../../meta/extract-providers/nsp.js";
import { keysFile } from "../../security/prod-keys.js";
import { createOrganizer } from "../../meta/library-organize.js";
import { cleanName, nameIn } from "../../meta/organize-naming.js";
import { loadSystems } from "../../retro/systems.js";
import * as retroCatalog from "../../retro/catalog.js";
import { refreshManual } from "../homebrew.js";
import fsp from "fs/promises";
import path from "path";
import debug from "../../debug.js";
import * as trashService from "../../library/trash-service.js";
import { apiWord } from "./api-words.js";

// One stuck nstool step must not hold the sweep for the extractor's ten minutes.
const NACP_TIMEOUT_MS = 60_000;

/**
 * The game's name from a file's NACP: the one already read for the game, else
 * the NACP cut out of the package (NSP/NSZ, or the secure partition of an
 * XCI/XCZ), a few MB of reads. Needs prod.keys and nstool.
 */
async function readNacpName({ abs }, id) {
  const stored = extractedMeta.get(id.baseTitleId)?.name;
  if (cleanName(stored)) return stored;
  const read = await extractFromPfs0({ absPath: abs, baseTitleId: id.baseTitleId }, { langPriority: env.langPriority, timeoutMs: NACP_TIMEOUT_MS });
  return read?.name ?? null;
}

/** What a NACP read depends on: the keys file (and when it changed) and nstool. */
async function nacpEpoch() {
  const keys = await fsp.stat(keysFile()).then((st) => `${st.mtimeMs}:${st.size}`, () => "none");
  return `${keys}|${(await resolveBinary()) ?? "none"}`;
}

export const defaultOrganizer = createOrganizer({
  incomingDir: env.incomingDir,
  romsDir: env.romsDirPath,
  romsRels: async () => {
    await libraryCache.get();
    return libraryCache.files().map((f) => f.rel);
  },
  adminName: (tid) => nameIn(gameDescriptions.names(tid), env.langPriority),
  titledbName: (tid) => nameIn(titledb.namesOf(tid), env.langPriority) ?? titledb.get(tid)?.name ?? null,
  readNacpName,
  nacpEpoch,
  retroDir: env.retroDir,
  homebrewDir: env.homebrewDir,
  systems: () => loadSystems(env.retroDir),
  readRefs: async (abs) => retroCatalog.referencedFiles(path.extname(abs).toLowerCase(), await fsp.readFile(abs, "utf8")),
  begin: activity.begin,
  rescan: () => libraryCache.invalidate({ rescan: true }),
  rescanRetro: () => retroCatalog.rescan(env.retroDir).catch((err) => debug.error("organize: retro rescan failed: %s", err.message)),
  rescanHomebrew: () => refreshManual().catch((err) => debug.error("organize: homebrew rescan failed: %s", err.message)),
  journal: ({ action, from, to }) => trashService.recordMove({ action, by: trashService.job("organize"), from, to }),
  undone: () => trashService.undoneInDropBox(),
});

export function mountLibraryOrganizeApi(router, requireSession, organizer = defaultOrganizer) {
  const handle = (fn) => async (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store");
    try {
      await fn(req, res);
    } catch (err) {
      debug.error("admin: organize: %s", err.message);
      res.status(500).json({ error: apiWord(req, "failed"), code: "failed" });
    }
  };

  router.get("/api/library/organize", handle((req, res) => res.json(organizer.view())));

  router.post("/api/library/organize/sweep", handle(async (req, res) => {
    // Asked for by hand: NACPs that could not be read before are tried again.
    const { moved } = await organizer.sweep({ retry: true });
    debug.log("admin: organize: moved %d", moved);
    res.json({ moved, ...organizer.view() });
  }));
}
