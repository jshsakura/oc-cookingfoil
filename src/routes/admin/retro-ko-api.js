/**
 * Korean titles from the bundled dictionary, from the admin page (retro tab):
 *
 *   GET  /admin/api/retro-ko           { index: { files, read, skipped, busy },
 *                                        confirmed: [K…], guesses: [K…] }
 *                                      confirmed: named by the ROM's content hash, shown already;
 *                                      guesses: named by the English title only, waiting for a decision
 *   POST /admin/api/retro-ko/guess     { game, approve }  keep the guess as the game's Korean name, or turn it down
 *   POST /admin/api/retro-ko/index     read the content hashes of new and changed ROM files now
 *
 * K = { id, system, systemName, name, file, ko, en, by }
 * A kept guess is saved with the names the admin gives (retro/names.js) and shows at once.
 */
import debug from "../../debug.js";
import { retroDir } from "../../helpers/envs.js";
import * as retroCatalog from "../../retro/catalog.js";
import * as koMatch from "../../retro/ko-match.js";
import * as romIndex from "../../retro/rom-index.js";
import { rebuildRetroShortcut } from "../retro.js";
import { apiWord } from "./api-words.js";

const LIST_MAX = 1000;

const row = (g, systems, hit) => ({
  id: g.id, system: g.system, systemName: systems[g.system]?.names?.ko ?? g.system,
  name: g.name, file: g.file, ko: hit.ko, en: hit.en ?? null, by: hit.by,
});

/** The confirmed names and the waiting guesses of the catalog now, as GET /admin/api/retro-ko sends them. */
export async function retroKoReview() {
  const catalog = await retroCatalog.current(retroDir);
  const confirmed = [];
  const guesses = [];
  for (const g of catalog.games) {
    const hit = koMatch.confirmed(g);
    if (hit) confirmed.push(row(g, catalog.systems, hit));
    else {
      const guess = koMatch.pendingGuess(g);
      if (guess) guesses.push(row(g, catalog.systems, guess));
    }
  }
  return {
    index: { ...romIndex.counts(catalog.games), busy: romIndex.busy() },
    confirmedTotal: confirmed.length,
    confirmed: confirmed.slice(0, LIST_MAX),
    guessesTotal: guesses.length,
    guesses: guesses.slice(0, LIST_MAX),
  };
}

/** Keeps or turns down a game's guessed Korean title: "ok", "no-game" or "no-guess". */
export async function decideRetroKoGuess(id, approve) {
  const catalog = await retroCatalog.current(retroDir);
  const g = catalog.byId.get(String(id ?? ""));
  if (!g) return "no-game";
  if (!(approve ? koMatch.approve(g) : koMatch.reject(g))) return "no-guess";
  // The shortcut carries the name too: built again in the background.
  if (approve) rebuildRetroShortcut(g.id);
  debug.log("admin: retro game %s Korean title guess %s", g.id, approve ? "kept" : "turned down");
  return "ok";
}

/** Starts reading the content hashes of new and changed ROM files (one pass at a time). */
export async function startRetroKoIndex() {
  romIndex.queue((await retroCatalog.current(retroDir)).games);
  return { started: true };
}

export function mountRetroKoApi(router, requireSession) {
  const guarded = (handler) => async (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store");
    try {
      await handler(req, res);
    } catch (err) {
      debug.error("admin retro-ko: %s", err.message);
      res.status(502).json({ error: err.message });
    }
  };

  router.get("/api/retro-ko", guarded(async (_req, res) => res.json(await retroKoReview())));

  router.post("/api/retro-ko/guess", guarded(async (req, res) => {
    const out = await decideRetroKoGuess(req.body?.game, req.body?.approve === true);
    if (out === "no-game") return res.status(404).json({ error: apiWord(req, "retroKo.noGame") });
    if (out === "no-guess") return res.status(409).json({ error: apiWord(req, "retroKo.noGuess") });
    res.json({ ok: true });
  }));

  router.post("/api/retro-ko/index", guarded(async (_req, res) => res.json({ ok: true, ...(await startRetroKoIndex()) })));
}
