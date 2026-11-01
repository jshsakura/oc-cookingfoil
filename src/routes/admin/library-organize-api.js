/**
 * The games folder's drop box (meta/library-organize.js) on the admin page:
 *
 *   GET  /admin/api/library/organize        { incoming, sweptAt, error, running, held, heldCount, waiting, recent }
 *   POST /admin/api/library/organize/sweep  sort the drop box now; answers with the view after it
 *
 * The same rules on files already in the games folder (library/tidy.js), from the file explorer:
 *   POST /admin/api/files/tidy/plan   { paths }          what a tidy would move and what it leaves, with why
 *   POST /admin/api/files/tidy/apply  { paths, moves }   the previewed moves that still stand
 */
import * as env from "../../helpers/envs.js";
import * as libraryCache from "../../meta/library-cache.js";
import * as titledb from "../../meta/titledb-store.js";
import * as activity from "../../tasks/activity.js";
import * as gameDescriptions from "../../meta/game-descriptions.js";
import * as extractedMeta from "../../meta/extracted-meta-store.js";
import { extractFromPfs0, resolveBinary } from "../../meta/extract-providers/nsp.js";
import { keysFile } from "../../security/prod-keys.js";
import { placeDropFolder } from "./upload-api.js";
import { createOrganizer } from "../../meta/library-organize.js";
import { createTidy } from "../../library/tidy.js";
import { createFileRoots, FileError } from "../../library/file-roots.js";
import { recordMove } from "../../library/journal.js";
import { identify } from "../../meta/file-identity.js";
import { requestLang } from "../../meta/langs.js";
import { cleanName, nameIn } from "../../meta/organize-naming.js";
import { loadSystems } from "../../retro/systems.js";
import { hashDb } from "../../retro/hash-db.js";
import { createDropHasher } from "../../meta/drop-hash.js";
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

const dropHasher = createDropHasher({ lookup: hashDb.lookup });

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
  identifyRoms: (files, refs, systems) => {
    if (env.retroDb) hashDb.ensureFresh(systems);
    return dropHasher.identify(files, refs, systems);
  },
  placeFolder: placeDropFolder,
  readRefs: async (abs) => retroCatalog.referencedFiles(path.extname(abs).toLowerCase(), await fsp.readFile(abs, "utf8")),
  begin: activity.begin,
  rescan: () => libraryCache.invalidate({ rescan: true }),
  rescanRetro: () => retroCatalog.rescan(env.retroDir).catch((err) => debug.error("organize: retro rescan failed: %s", err.message)),
  rescanHomebrew: () => refreshManual().catch((err) => debug.error("organize: homebrew rescan failed: %s", err.message)),
  journal: ({ action, from, to, extra }) => trashService.recordMove({ action, by: trashService.job("organize"), from, to, extra }),
  undone: () => trashService.undoneInDropBox(),
});

const WHOLE_MAX = 500;
const TIDY_PATHS_MAX = 500;

const tidyRoots = createFileRoots();
export const defaultTidy = createTidy({
  root: () => tidyRoots.roots().find((r) => r.key === "games"),
  collect: (rels) => tidyRoots.collect("games", rels, { mayBeRoot: true }),
  identify,
  romsRels: async () => {
    await libraryCache.get();
    return libraryCache.files().map((f) => f.rel);
  },
  adminName: (tid) => nameIn(gameDescriptions.names(tid), env.langPriority),
  titledbName: (tid) => nameIn(titledb.namesOf(tid), env.langPriority) ?? titledb.get(tid)?.name ?? null,
  journal: recordMove,
  rescan: () => libraryCache.invalidate({ rescan: true }),
});

export function mountFilesTidyApi(router, requireSession, tidy = defaultTidy) {
  const paths = (v) => (Array.isArray(v) && v.length && v.length <= TIDY_PATHS_MAX && v.every((p) => typeof p === "string") ? v : null);
  const handle = (fn) => async (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store");
    const rels = paths(req.body?.paths);
    if (!rels) return res.status(400).json({ error: apiWord(req, "failed"), code: "bad-request" });
    try {
      await fn(req, res, rels);
    } catch (err) {
      if (err instanceof FileError) return res.status(err.status).json({ error: err.message, code: err.code });
      debug.error("admin: tidy: %s", err.message);
      res.status(500).json({ error: apiWord(req, "failed"), code: "failed" });
    }
  };
  router.post("/api/files/tidy/plan", handle(async (req, res, rels) => res.json(await tidy.plan(rels, requestLang(req)))));
  router.post("/api/files/tidy/apply", handle(async (req, res, rels) => {
    const moves = Array.isArray(req.body?.moves) ? req.body.moves.filter((m) => typeof m?.from === "string" && typeof m?.to === "string") : [];
    const out = await tidy.apply(rels, moves, { by: trashService.actorOf(req) });
    debug.log("admin: tidy: moved %d (%d skipped)", out.moved.length, out.skipped.length);
    res.json(out);
  }));
}

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
    // An upload names what it wrote whole, so those are sorted without the copy wait.
    const sent = req.body?.whole;
    const whole = Array.isArray(sent) && sent.length <= WHOLE_MAX && sent.every((r) => typeof r === "string") ? new Set(sent) : null;
    const { moved } = await organizer.sweep({ retry: true, whole });
    debug.log("admin: organize: moved %d", moved);
    res.json({ moved, ...organizer.view() });
  }));
}
