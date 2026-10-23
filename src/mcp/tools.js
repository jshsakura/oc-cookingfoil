/**
 * The capabilities served as MCP tools: those an automation token may use, reads only for now.
 * Write tools join with the MCP action journal. Destructive ones never join until a person's
 * approval of each run is enforced in code (plan: deleting needs a human, never a model's confirm).
 */
import { registry } from "../capabilities/registry.js";

export const SERVED_SAFETY = new Set(["read"]);

export const servedTools = () => registry.all.filter((c) => c.token && SERVED_SAFETY.has(c.safety));
