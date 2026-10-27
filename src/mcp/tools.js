/**
 * The capabilities served over MCP: those an automation token may use, every read, and a write once
 * it has a preview (server.js asks for confirm='approve' after showing it). Destructive ones wait
 * until deletes go through the trash with a per-call cap.
 *
 * They are served as one tool per area, ServiceNow MCP style: `games { action, args, confirm? }`.
 * tools/list goes with every request, so it carries only the areas and their action names; an
 * action's arguments and result come from help when the agent needs them.
 */
import { registry } from "../capabilities/registry.js";

export const servedTools = () => registry.all.filter((c) => (c.token || c.mcp) && (c.safety === "read" || (c.safety === "write" && c.preview)));

/** Served as a tool of its own: the entry point an agent calls before any area. */
export const STANDALONE = new Set(["help"]);

/** What each area tool covers. Every area with a served capability needs a line. */
export const AREA_TEXT = {
  games: "Switch games in the library: search, details, art and patches.",
  library: "Library folders and files, and the trash.",
  retro: "Retro (RetroArch) games, cores, Korean names, ROM patches and box art.",
  jobs: "Background jobs and their progress.",
  admin: "Consoles, accounts, alerts, settings, restart.",
  plugins: "Plugins, their state and field value sources. Switching one on is for the admin page.",
};

/** Whether an action changes something, and so previews first and takes confirm. */
export const gated = (cap) => cap.safety !== "read";

/** The area tools, each with its served capabilities, in registry order. */
export function areaTools() {
  const areas = new Map();
  for (const cap of servedTools()) {
    if (STANDALONE.has(cap.id)) continue;
    if (!areas.has(cap.area)) areas.set(cap.area, []);
    areas.get(cap.area).push(cap);
  }
  return [...areas].map(([name, caps]) => ({ name, caps }));
}

const CONFIRM = { type: "string", enum: ["approve"], description: "Omit to preview a writing action; approve only after the user agrees" };

/** An area tool's input: which action, its arguments, and confirm when any action writes. */
export function areaInput({ caps }) {
  return {
    type: "object",
    properties: {
      action: { type: "string", enum: caps.map((c) => c.id) },
      args: { type: "object", description: "The action's arguments; help { tool: action } lists them" },
      ...(caps.some(gated) ? { confirm: CONFIRM } : {}),
    },
    required: ["action"],
  };
}

export function areaDescription({ name, caps }) {
  const writes = caps.filter(gated).map((c) => c.id);
  // The action names are already in the input's enum.
  return [
    AREA_TEXT[name] ?? "",
    writes.length ? `Writing (${writes.join(", ")}): call without confirm to preview, then with confirm='approve' once the user agrees.` : "",
  ].filter(Boolean).join(" ");
}

/** The area tool an action is served under, or null. */
export const toolOf = (cap) => (STANDALONE.has(cap.id) ? cap.id : cap.area);
