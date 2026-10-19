/**
 * What an admin attached to a homebrew app by hand, forgotten with the app: its pictures, its own
 * description, the tool or port choice, the shortcut's CPU cores, the 검수됨 mark and the hidden mark. Removing an app without this leaves the
 * entries behind, and an app put back later under the same id would come back with them.
 */
import * as media from "./homebrew-media.js";
import * as descriptions from "./homebrew-descriptions.js";
import * as kinds from "./homebrew-kinds.js";
import * as cores from "./homebrew-cores.js";
import * as verified from "./homebrew-verified.js";
import * as disabled from "./homebrew-disabled.js";
import debug from "../debug.js";

export async function forgetExtras(id) {
  const key = String(id ?? "");
  if (!key) return;
  // Each step stands alone: one that cannot clean up must not keep the others from running.
  const steps = [
    () => media.forget(key),
    () => descriptions.reset(key),
    () => kinds.set(key, "tool"),
    () => cores.set(key, 3),
    () => verified.set(key, false),
    () => disabled.setEnabled(key, true),
  ];
  for (const step of steps) {
    try { await step(); } catch (err) { debug.error("homebrew: forgetting extras of %s: %s", key, err.message); }
  }
}
