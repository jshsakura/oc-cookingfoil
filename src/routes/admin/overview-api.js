/**
 * The overview page's one read: what needs the admin, how the server stands, what happened lately.
 *
 *   GET /admin/api/overview
 *     { generatedAt, lanes (the sign-in lanes, as /api/stats has them),
 *       todo:   [{ code, n?, severity?, ...warning }]   only what needs doing; config warnings first
 *       status: { games: { titles, files, bytes }, disk: [{ key, free, size }],
 *                 verify: { status, total, counts }, transfers: { active }, plugins: { on, total } }
 *       recent: [{ at, event, text, status }]           the newest alerts, sent or not, first line only
 *       added:  { games: [{ name, kind, titleId, version, at }],
 *                 patches: [{ id, name, game, titleId, at, ...what the patch edit dialog fills and posts back }] }
 *               the newest game files and patches in the library, newest first }
 *
 * Everything here is already kept in memory by its owner, so a read only counts. The answer is kept
 * for a few seconds anyway: the page asks every 15 seconds and several tabs may be open. A patch edit
 * drops the kept answer, so the page shows a rename at once. Counts and names only, no addresses or keys.
 */
import fsp from "node:fs/promises";
import * as libraryCache from "../../meta/library-cache.js";
import verifyQueue from "../../meta/verify-service.js";
import transferLog from "../../helpers/transfer-log.js";
import * as alerts from "../../helpers/alerts.js";
import { pluginRegistry } from "../../plugins/instance.js";
import { romsDirPath, dataDir } from "../../helpers/envs.js";
import * as userPatches from "../../meta/user-patches.js";
import * as patchInfo from "../../meta/patch-info.js";
import { gameOf } from "../../meta/game-info.js";

const FRESH_MS = 10_000;
const RECENT_MAX = 8;
const TEXT_MAX = 140;
const ADDED_GAMES = 8;
const ADDED_PATCHES = 6;
// A plugin in one of these states was turned on and is not running as asked.
const PLUGIN_FAILING = new Set(["failed", "crash-disabled", "auto-disabled", "cooling"]);

async function diskOf(key, dir) {
  try {
    const s = await fsp.statfs(dir);
    return { key, free: s.bavail * s.bsize, size: s.blocks * s.bsize };
  } catch {
    return null;
  }
}

function gamesOf(files) {
  const titles = new Set();
  let bytes = 0;
  for (const f of files) {
    const id = f.baseTitleId ?? f.titleId;
    if (id) titles.add(id);
    bytes += f.size || 0;
  }
  return { titles: titles.size, files: files.length, bytes };
}

// The edit dialog posts every field back, so a field left out here would be cleared by a save.
const editable = ({ homebrew, size, files, ko, description, version, author, game_version, update_version }) => ({
  ...(homebrew ? { homebrew } : {}), size, files, ko: ko ?? null, description: description ?? null, version: version ?? null,
  author: author ?? null, game_version: game_version ?? null, update_version: update_version ?? null,
});

/** The newest game files and patches: what came in lately, at a glance. */
function addedOf(files, patches, nameOf) {
  const games = files.filter((f) => f.mtime).sort((a, b) => b.mtime - a.mtime).slice(0, ADDED_GAMES)
    .map((f) => ({ name: f.name, kind: f.kind, titleId: f.titleId, version: f.version, at: f.mtime * 1000 }));
  const newest = patches.filter((p) => p.updated_at).sort((a, b) => b.updated_at - a.updated_at).slice(0, ADDED_PATCHES)
    .map((p) => ({ id: p.id, name: p.name, game: p.title_id ? nameOf(p.title_id) : null, titleId: p.title_id ?? null, at: p.updated_at * 1000, ...editable(p) }));
  return { games, patches: newest };
}

const firstLine = (text) => String(text ?? "").split("\n").find((l) => l.trim())?.trim().slice(0, TEXT_MAX) ?? "";

/**
 * deps: warnings() and counts() come from the admin router, which owns the auth state; the rest
 * default to the shared instances and are replaced in tests.
 */
export function createOverview({
  warnings = () => [],
  lanes = () => null,
  counts = async () => ({}),
  files = () => libraryCache.files(),
  verify = () => verifyQueue.view(),
  activeTransfers = () => transferLog.active().length,
  plugins = () => pluginRegistry().list(),
  recentAlerts = () => alerts.recent(),
  patches = () => userPatches.list(),
  nameOf = (titleId) => gameOf(titleId)?.name ?? null,
  patchRevision = () => patchInfo.revision(),
  disks = () => Promise.all([diskOf("games", romsDirPath), diskOf("data", dataDir)]),
  now = Date.now,
} = {}) {
  let kept = null;

  async function build() {
    const c = await counts();
    const v = verify();
    const pl = plugins();
    const all = files();
    const failing = pl.filter((p) => p.enabled && PLUGIN_FAILING.has(p.state));
    const todo = [
      ...warnings().map((w) => ({ ...w })),
      { code: "damaged", n: v.counts?.damaged ?? 0 },
      { code: "pending-devices", n: c.pendingDevices ?? 0 },
      { code: "pending-accounts", n: c.pendingAccounts ?? 0 },
      { code: "inbox", n: c.inbox ?? 0 },
      { code: "plugins-failing", n: failing.length, ids: failing.map((p) => p.id) },
      { code: "lockouts", n: c.lockouts ?? 0 },
    ].filter((t) => t.n === undefined || t.n > 0);
    return {
      generatedAt: now(),
      lanes: lanes(),
      todo,
      status: {
        games: gamesOf(all),
        disk: (await disks()).filter(Boolean),
        verify: { status: v.status, total: v.total, counts: v.counts },
        transfers: { active: activeTransfers() },
        plugins: { on: pl.filter((p) => p.state === "on" || p.state === "cooling").length, total: pl.length },
      },
      recent: recentAlerts().slice(0, RECENT_MAX).map((e) => ({ at: e.at, event: e.event, text: firstLine(e.text), status: e.status })),
      added: addedOf(all, await Promise.resolve(patches()).catch(() => []), nameOf),
    };
  }

  return {
    async read() {
      const rev = patchRevision();
      if (kept && kept.rev === rev && now() - kept.at < FRESH_MS) return kept.value;
      const value = await build();
      kept = { at: now(), rev, value };
      return value;
    },
    forget() { kept = null; },
  };
}

// The overview the admin router mounted, so the capability (server_overview) reads the same answer.
let mounted = null;

/** The current overview. Before the admin router mounts it (a bare MCP host), the counts it owns are left out. */
export async function readOverview() {
  mounted ??= createOverview();
  return mounted.read();
}

export function mountOverviewApi(router, requireSession, deps) {
  const overview = createOverview(deps);
  mounted = overview;
  router.get("/api/overview", async (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store").json(await overview.read());
  });
  return overview;
}
