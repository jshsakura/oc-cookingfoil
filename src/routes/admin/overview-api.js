/**
 * The overview page's one read: what needs the admin, how the server stands, what happened lately.
 *
 *   GET /admin/api/overview
 *     { generatedAt,
 *       todo:   [{ code, n?, severity?, ...warning }]   only what needs doing; config warnings first
 *       status: { games: { titles, files, bytes }, disk: [{ key, free, size }],
 *                 verify: { status, total, counts }, transfers: { active }, plugins: { on, total } }
 *       recent: [{ at, event, text, status }]           the newest alerts, sent or not, first line only }
 *
 * Everything here is already kept in memory by its owner, so a read only counts. The answer is kept
 * for a few seconds anyway: the page asks every 15 seconds and several tabs may be open. Counts and
 * names only, no addresses or keys.
 */
import fsp from "node:fs/promises";
import * as shopCache from "../../meta/shop-cache.js";
import verifyQueue from "../../meta/verify-service.js";
import transferLog from "../../helpers/transfer-log.js";
import * as alerts from "../../helpers/alerts.js";
import { pluginRegistry } from "../../plugins/instance.js";
import { romsDirPath, dataDir } from "../../helpers/envs.js";

const FRESH_MS = 10_000;
const RECENT_MAX = 8;
const TEXT_MAX = 140;
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

const firstLine = (text) => String(text ?? "").split("\n").find((l) => l.trim())?.trim().slice(0, TEXT_MAX) ?? "";

/**
 * deps: warnings() and counts() come from the admin router, which owns the auth state; the rest
 * default to the shared instances and are replaced in tests.
 */
export function createOverview({
  warnings = () => [],
  counts = async () => ({}),
  files = () => shopCache.files(),
  verify = () => verifyQueue.view(),
  activeTransfers = () => transferLog.active().length,
  plugins = () => pluginRegistry().list(),
  recentAlerts = () => alerts.recent(),
  disks = () => Promise.all([diskOf("games", romsDirPath), diskOf("data", dataDir)]),
  now = Date.now,
} = {}) {
  let kept = null;

  async function build() {
    const c = await counts();
    const v = verify();
    const pl = plugins();
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
      todo,
      status: {
        games: gamesOf(files()),
        disk: (await disks()).filter(Boolean),
        verify: { status: v.status, total: v.total, counts: v.counts },
        transfers: { active: activeTransfers() },
        plugins: { on: pl.filter((p) => p.state === "on" || p.state === "cooling").length, total: pl.length },
      },
      recent: recentAlerts().slice(0, RECENT_MAX).map((e) => ({ at: e.at, event: e.event, text: firstLine(e.text), status: e.status })),
    };
  }

  return {
    async read() {
      if (kept && now() - kept.at < FRESH_MS) return kept.value;
      const value = await build();
      kept = { at: now(), value };
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
