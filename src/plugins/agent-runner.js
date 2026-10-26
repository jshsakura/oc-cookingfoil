/**
 * Asks the metadata plugins about titles in the background and keeps the answers (agent-cache.js).
 * Nothing here runs on the path of a shop listing or a download: track() and want() only queue, and the
 * hook is called from the queue, one title at a time per plugin.
 *
 *   createAgentRunner({ registry, store, onChange?, log?, now?, retryMs?, queueMax? }) -> { track, want, pending, stats, stop }
 *
 * want(titleId, { name?, hasFile }) asks every active metadata plugin that has no fresh answer for the
 * title. The title may be one the library has no file for: the hook gets { titleId, name, hasFile } and
 * nothing else about the library. An answer is cut down to what the core keeps (agent-answer.js) and
 * stored with the time; a plugin that is cooling, off or failing leaves the title unanswered and it is
 * tried again after retryMs, never in a loop. onChange fires after answers were stored (debounced), so
 * the caller can drop the lists it cached.
 */
import { parseMetadata } from "./agent-answer.js";
import { TITLE_ID_RE } from "./agent-cache.js";

export const QUEUE_MAX = 20_000;
export const RETRY_MS = 10 * 60_000;
const CHANGE_DEBOUNCE_MS = 2_000;

export function createAgentRunner({ registry, store, onChange = () => {}, log = () => {}, now = Date.now, retryMs = RETRY_MS, queueMax = QUEUE_MAX }) {
  // per plugin: titles waiting, the one in flight, and when a failed title may be asked again
  const lanes = new Map();
  const stat = new Map();
  let changeTimer = null;
  let stopped = false;

  const laneOf = (id) => {
    if (!lanes.has(id)) lanes.set(id, { queue: new Map(), running: false, later: new Map() });
    return lanes.get(id);
  };
  const statOf = (id) => {
    if (!stat.has(id)) stat.set(id, { asked: 0, answered: 0, empty: 0, failed: 0, lastAt: null });
    return stat.get(id);
  };

  function changed() {
    clearTimeout(changeTimer);
    changeTimer = setTimeout(() => { try { onChange(); } catch (err) { log(`agents: change callback failed: ${err.message}`); } }, CHANGE_DEBOUNCE_MS);
    changeTimer.unref?.();
  }

  async function work(id) {
    const lane = laneOf(id);
    if (lane.running) return;
    lane.running = true;
    try {
      await store.load(id);
      while (!stopped && lane.queue.size) {
        const [titleId, job] = lane.queue.entries().next().value;
        lane.queue.delete(titleId);
        if (store.fresh(store.get(id, titleId))) continue;
        const s = statOf(id);
        s.asked++;
        const r = await registry.callHook(id, "metadata", { titleId, name: job.name ?? null, hasFile: job.hasFile === true }, { lang: "en", valid: (v) => parseMetadata(v) !== null });
        s.lastAt = now();
        if (r.value !== undefined) {
          const answer = parseMetadata(r.value);
          await store.put(id, titleId, answer);
          if (Object.keys(answer.fields).length) s.answered++; else s.empty++;
          changed();
          continue;
        }
        s.failed++;
        lane.later.set(titleId, now() + retryMs);
        // A plugin that is cooling or gone is not asked about the rest of the queue now; they come back with the next scan.
        if (r.skipped) { lane.queue.clear(); break; }
      }
    } catch (err) {
      log(`agents: ${id}: ${err.message}`);
    } finally {
      lane.running = false;
    }
  }

  function want(titleId, { name = null, hasFile = false } = {}) {
    if (stopped || typeof titleId !== "string" || !TITLE_ID_RE.test(titleId)) return;
    const key = titleId.toUpperCase();
    for (const id of registry.activeProviding("metadata")) {
      const lane = laneOf(id);
      if (lane.queue.has(key) || (lane.later.get(key) ?? 0) > now()) continue;
      if (store.fresh(store.get(id, key))) continue;
      if (lane.queue.size >= queueMax) continue;
      lane.queue.set(key, { name, hasFile });
      setImmediate(() => { work(id); });
    }
  }

  /** The library's titles after a scan: [{ titleId, name?, hasFile? }]. */
  function track(titles) {
    if (stopped || !registry.activeProviding("metadata").length) return;
    for (const t of titles) want(t.titleId, t);
  }

  const pending = () => [...lanes.values()].reduce((n, l) => n + l.queue.size, 0);
  const stats = (id) => ({ ...statOf(id), waiting: lanes.get(id)?.queue.size ?? 0, cached: store.count(id) });
  const stop = () => { stopped = true; clearTimeout(changeTimer); };

  return { track, want, pending, stats, stop };
}
