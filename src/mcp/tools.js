/**
 * The capabilities served as MCP tools: those an automation token may use, every read, and a write
 * once it has a preview (server.js asks for confirm='approve' after showing it). Destructive ones wait
 * until deletes go through the trash with a per-call cap.
 */
import { registry } from "../capabilities/registry.js";

export const servedTools = () => registry.all.filter((c) => c.token && (c.safety === "read" || (c.safety === "write" && c.preview)));

const CONFIRM = { type: "string", enum: ["approve"], description: "Omit to preview; approve only after the user agrees" };

/** Whether a tool changes something, and so previews first and takes confirm. */
export const gated = (cap) => cap.safety !== "read";
/** The input an agent sees: a gated tool's own arguments plus confirm. */
export const toolInput = (cap) => (gated(cap) ? { ...cap.input, properties: { ...cap.input.properties, confirm: CONFIRM } } : cap.input);
export const toolDescription = (cap) => (gated(cap) ? `${cap.description} (confirm='approve')` : cap.description);
