/**
 * The plugins table (security.db) and the two marker files that survive a crash.
 *
 *   createPluginStore(db, now) -> { ensure, get, all, update }
 *   Row fields are camelCase here: enabled (boolean), failStreak, hookStreak, cooldownStep, cooldownUntil,
 *   disabledReason, disabledAt, lastError, lastErrorAt, versionSeen, variantKeys (array).
 *
 *   data/plugins-booting   the id being started; written just before start(), removed after
 *   data/plugins-crash     { id, at, message } written by the process handler before the process exits
 * A marker that is still there at the next start names the plugin that took the process down.
 */
import fs from "node:fs";
import path from "node:path";

const COLUMNS = {
  enabled: "enabled", failStreak: "fail_streak", hookStreak: "hook_streak", cooldownStep: "cooldown_step",
  cooldownUntil: "cooldown_until", disabledReason: "disabled_reason", disabledAt: "disabled_at",
  lastError: "last_error", lastErrorAt: "last_error_at", versionSeen: "version_seen", variantKeys: "variant_keys",
};

function fromRow(r) {
  if (!r) return null;
  let keys = [];
  try { keys = JSON.parse(r.variant_keys); } catch { /* a damaged list reads as none */ }
  return {
    id: r.id, enabled: r.enabled === 1, failStreak: r.fail_streak, hookStreak: r.hook_streak,
    cooldownStep: r.cooldown_step, cooldownUntil: r.cooldown_until, disabledReason: r.disabled_reason,
    disabledAt: r.disabled_at, lastError: r.last_error, lastErrorAt: r.last_error_at, versionSeen: r.version_seen,
    variantKeys: Array.isArray(keys) ? keys.filter((k) => typeof k === "string") : [],
  };
}

export function createPluginStore(db, now = Date.now) {
  const get = (id) => fromRow(db.prepare("SELECT * FROM plugins WHERE id = ?").get(id));
  return {
    get,
    all: () => db.prepare("SELECT * FROM plugins ORDER BY id").all().map(fromRow),
    /** A plugin seen for the first time starts switched off: nothing turns itself on. */
    ensure(id) {
      db.prepare("INSERT OR IGNORE INTO plugins (id, enabled, updated_at) VALUES (?, 0, ?)").run(id, now());
      return get(id);
    },
    update(id, patch) {
      const sets = [];
      const args = [];
      for (const [key, value] of Object.entries(patch)) {
        const col = COLUMNS[key];
        if (!col) throw new Error(`unknown plugin field ${key}`);
        sets.push(`${col} = ?`);
        args.push(key === "enabled" ? (value ? 1 : 0) : key === "variantKeys" ? JSON.stringify(value) : value ?? null);
      }
      db.prepare(`UPDATE plugins SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`).run(...args, now(), id);
      return get(id);
    },
    remove: (id) => db.prepare("DELETE FROM plugins WHERE id = ?").run(id),
  };
}

export function createMarkers(dataDir) {
  const booting = path.join(dataDir, "plugins-booting");
  const crash = path.join(dataDir, "plugins-crash");
  const readText = (file) => { try { return fs.readFileSync(file, "utf8"); } catch { return null; } };
  const drop = (file) => { try { fs.rmSync(file, { force: true }); } catch { /* nothing to drop */ } };
  return {
    markBooting: (id) => fs.writeFileSync(booting, `${id}\n`),
    clearBooting: () => drop(booting),
    /** Writes synchronously: the process is about to exit. */
    writeCrash: (id, message) => fs.writeFileSync(crash, JSON.stringify({ id, at: Date.now(), message: String(message).slice(0, 300) })),
    /** The ids that were mid-start or crashed at the last exit, and the markers cleared. */
    takeLeftovers() {
      const out = [];
      const b = readText(booting)?.trim();
      if (b) out.push({ id: b, why: "crash-during-start" });
      const c = readText(crash);
      if (c) {
        try {
          const j = JSON.parse(c);
          // Both marks naming one plugin are one event: the crash mark says more, so it replaces the boot mark.
          if (typeof j.id === "string" && j.id) out.splice(0, out.length, ...out.filter((o) => o.id !== j.id), { id: j.id, why: "crash", message: j.message ?? "" });
        } catch { /* an unreadable marker names no one */ }
      }
      drop(booting);
      drop(crash);
      return out;
    },
  };
}
