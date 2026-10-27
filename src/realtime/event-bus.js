/**
 * Tells the open pages that something changed, so they read it again. An event is a hint, never the
 * data: { topic, payload } with a small payload (a name, a count). Nothing is kept. A page that was
 * not connected misses it and reads the current state from the API when it connects, the way it does
 * for `library-updated`.
 *
 *   publish({ topic, audience, payload, adminExtra })   delivers now to whoever is connected
 *   subscribe(who, handler)                             returns the unsubscribe function
 *
 * `who` is { account, admin }. `audience` is { all: true }, { admin: true } or { accounts: [...] };
 * an empty or unknown audience is refused, never "everyone". `adminExtra` (who did it) is merged into
 * the payload for admins only, so one event serves both.
 */
import debug from "../debug.js";

export const PAYLOAD_MAX_BYTES = 4096;
const TOPIC_RE = /^[a-z][a-z0-9._-]{0,31}$/;

const fail = (what, why) => Object.assign(new Error(`${what}: ${why}`), { status: 400 });

const reaches = (a, who) =>
  a.all === true || (a.admin === true && who.admin === true) || (Array.isArray(a.accounts) && who.account != null && a.accounts.includes(who.account));

const validAudience = (a) => a && typeof a === "object" && (a.all === true || a.admin === true || (Array.isArray(a.accounts) && a.accounts.length > 0));

const checked = (label, value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw fail(label, "must be an object");
  if (Buffer.byteLength(JSON.stringify(value)) > PAYLOAD_MAX_BYTES) throw fail(label, `is over ${PAYLOAD_MAX_BYTES} bytes`);
};

export function createEventBus() {
  const listeners = new Set();

  return {
    publish({ topic, audience, payload, adminExtra }) {
      if (typeof topic !== "string" || !TOPIC_RE.test(topic)) throw fail("topic", "must be a short lower-case name");
      if (!validAudience(audience)) throw fail("audience", "must be { all: true }, { admin: true } or a non-empty { accounts }");
      checked("payload", payload);
      if (adminExtra !== undefined) checked("adminExtra", adminExtra);
      for (const l of [...listeners]) {
        if (!reaches(audience, l.who)) continue;
        try {
          l.handler({ topic, payload: l.who.admin && adminExtra ? { ...payload, ...adminExtra } : payload });
        } catch (err) {
          debug.error("event bus: a listener failed: %s", err.message);
        }
      }
    },

    subscribe(who, handler) {
      const l = { who, handler };
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}
