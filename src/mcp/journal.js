/**
 * Every write an MCP tool carried out, one JSON line each in <data dir>/mcp-actions.jsonl:
 * { at, tool, token, by, input, ok, error? }. Previews change nothing and are not written.
 */
import fs from "fs";
import path from "path";
import { dataDir } from "../helpers/envs.js";
import debug from "../debug.js";

export const journalFile = () => path.join(dataDir, "mcp-actions.jsonl");

export function record(entry) {
  try {
    fs.appendFileSync(journalFile(), `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
  } catch (err) {
    debug.error("mcp journal: %s", err.message);
  }
}
