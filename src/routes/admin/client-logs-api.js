/**
 * The logs consoles send in (POST /api/client/log), for the admin to read.
 *
 *   GET /admin/api/client-logs                    { consoles: [{ prefix, label, files: [{ name, size, at }] }] newest first,
 *                                                   bugReports: [{ prefix, label, owner, count, first, last }] most first }
 *   GET /admin/api/client-logs/<prefix>/<file>    the log as text/plain
 *
 * A console is named by the label it was approved under when one matches its
 * key's first 8 characters.
 */
import fsp from "fs/promises";
import path from "path";
import * as store from "../../security/store.js";
import { LOGS_DIR, bugReports } from "../client-log.js";

const PREFIX_RE = /^[0-9a-f]{8}$/;
const FILE_RE = /^(\d{8}-\d{6}(-\d+)?|latest)\.txt$/;
const MAX_READ = 256 * 1024;

async function filesOf(prefix) {
  const dir = path.join(LOGS_DIR, prefix);
  const names = (await fsp.readdir(dir).catch(() => [])).filter((f) => FILE_RE.test(f) && f !== "latest.txt");
  const files = await Promise.all(names.map(async (name) => {
    const st = await fsp.stat(path.join(dir, name)).catch(() => null);
    return st?.isFile() ? { name, size: st.size, at: st.mtimeMs } : null;
  }));
  return files.filter(Boolean).sort((a, b) => b.name.localeCompare(a.name));
}

export function mountClientLogsApi(router, requireSession) {
  router.get("/api/client-logs", async (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store");
    const labels = new Map(store.devicesSnapshot().approved.map((d) => [d.deviceKey.slice(0, 8).toLowerCase(), d.label]));
    const prefixes = (await fsp.readdir(LOGS_DIR).catch(() => [])).filter((p) => PREFIX_RE.test(p));
    const consoles = await Promise.all(prefixes.map(async (prefix) => ({ prefix, label: labels.get(prefix) ?? null, files: await filesOf(prefix) })));
    res.json({
      consoles: consoles.filter((c) => c.files.length).sort((a, b) => (b.files[0]?.at ?? 0) - (a.files[0]?.at ?? 0)),
      // Who pressed "send a bug report" how often: the account without its kind ("user:", "google:").
      bugReports: bugReports().map((r) => ({ ...r, label: labels.get(r.prefix) ?? null, owner: String(r.owner ?? "").replace(/^[a-z]+:/, "") })),
    });
  });

  router.get("/api/client-logs/:prefix/:file", async (req, res) => {
    if (!requireSession(req, res)) return;
    const { prefix, file } = req.params;
    if (!PREFIX_RE.test(prefix) || !FILE_RE.test(file)) return res.status(400).json({ error: "bad log name" });
    const handle = await fsp.open(path.join(LOGS_DIR, prefix, file), "r").catch(() => null);
    if (!handle) return res.status(404).json({ error: "no such log" });
    try {
      const buf = Buffer.alloc(MAX_READ);
      const { bytesRead } = await handle.read(buf, 0, MAX_READ, 0);
      res.set({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
      res.type("text/plain; charset=utf-8").send(buf.subarray(0, bytesRead));
    } finally {
      await handle.close();
    }
  });
}
