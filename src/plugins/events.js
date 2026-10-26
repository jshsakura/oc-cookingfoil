/**
 * Events: things that happened (a download ended, a device was approved, the library changed, a client
 * reported an install) told to the plugins that handle them. Nobody waits for a plugin here.
 *
 *   createEvents(registry, { secret, log }) -> { emit(kind, facts, who), statsOf(id), clear(id) }
 *
 * emit() puts the event on the queue of each plugin that is on and exports the handler, and returns; it never
 * throws and costs one push per plugin. Each plugin has one queue, handled in order, one at a time, with the
 * handler's own time limit. A queue holds QUEUE_MAX events; the oldest is dropped (and counted) when it is full.
 * A handler that fails is counted and logged, but it never counts toward a pause (the hook runner knows event
 * kinds as listing hooks), so an event can not switch off a plugin's real work. The queues live in memory.
 *
 * Privacy: `facts` carry no person. The device is a short HMAC of (server secret, plugin id, device key), different
 * for every plugin, so two plugins can not match the same device. An address or an account name is handed over
 * only when the plugin's manifest asked for it (events.identity) and the operator saw that when switching it on;
 * otherwise the key is not in the payload at all.
 */
import { createHmac } from "node:crypto";
import { EVENT_KINDS } from "./manifest.js";

export const QUEUE_MAX = 200;

export function createEvents(registry, { secret, log = () => {} } = {}) {
  const queues = new Map(); // id -> { items, running }
  const stats = new Map(); // id -> { handled, dropped, failed, lastAt, lastKind }
  const statOf = (id) => {
    let s = stats.get(id);
    if (!s) stats.set(id, (s = { handled: 0, dropped: 0, failed: 0, lastAt: null, lastKind: null }));
    return s;
  };

  const deviceOf = (id, deviceKey) => {
    if (!deviceKey) return null;
    return createHmac("sha256", secret()).update(`plugin-device\0${id}\0${deviceKey}`).digest("hex").slice(0, 12);
  };

  async function drain(id) {
    const q = queues.get(id);
    if (!q || q.running) return;
    q.running = true;
    try {
      while (q.items.length) {
        const { kind, payload, console: facts } = q.items.shift();
        const s = statOf(id);
        const r = await registry.callHook(id, kind, payload, { console: facts });
        if (r.skipped) {
          if (r.skipped === "not-running" || r.skipped === "no-hook") q.items.length = 0;
          continue;
        }
        s.lastAt = Date.now();
        s.lastKind = kind;
        if (r.error) {
          s.failed++;
          log(`${id}: ${kind} handler failed: ${r.error.message}`);
        } else {
          s.handled++;
        }
      }
    } finally {
      q.running = false;
    }
  }

  /**
   * facts: plain facts of the event (title id, path, bytes ...). who: { deviceKey?, ip?, account?, console? } of the
   * asking side, never copied into the payload except as the manifest allows.
   */
  function emit(kind, facts = {}, who = {}) {
    try {
      if (!EVENT_KINDS.includes(kind)) return;
      for (const id of registry.activeProviding("event")) {
        if (!registry.hasHook(id, kind)) continue;
        const wants = registry.manifestOf(id)?.events?.identity ?? [];
        const payload = { ...facts, device: deviceOf(id, who.deviceKey) };
        if (wants.includes("ip") && who.ip) payload.ip = who.ip;
        if (wants.includes("account") && who.account) payload.account = who.account;
        let q = queues.get(id);
        if (!q) queues.set(id, (q = { items: [], running: false }));
        if (q.items.length >= QUEUE_MAX) {
          q.items.shift();
          statOf(id).dropped++;
        }
        q.items.push({ kind, payload: Object.freeze(payload), console: who.console });
        setImmediate(() => drain(id).catch((err) => log(`${id}: event queue: ${err.message}`)));
      }
    } catch (err) {
      log(`event ${kind}: ${err.message}`);
    }
  }

  return {
    emit,
    statsOf: (id) => ({ ...statOf(id), queued: queues.get(id)?.items.length ?? 0 }),
    clear: (id) => { queues.delete(id); },
  };
}
