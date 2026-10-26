/**
 * The one call the rest of the server uses to tell plugins something happened:
 *   emitPluginEvent("deviceApproved", { ... }, { deviceKey, ip, account })
 * It returns at once, never throws, and does nothing until startPlugins() has connected the events.
 * The server's modules import this file only, never the plugin machinery behind it.
 */
let sink = null;

export const connectPluginEvents = (fn) => { sink = fn; };

export function emitPluginEvent(kind, facts, who) {
  try {
    sink?.(kind, facts, who);
  } catch {
    // An event must never change what the request that caused it did.
  }
}
