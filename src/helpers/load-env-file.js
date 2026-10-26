import { existsSync } from "node:fs";

/**
 * Reads KEY=VALUE lines from a .env file into process.env with Node's own
 * parser. Variables already present in the real environment win, and a missing
 * file is not an error.
 */
export function loadEnvFile(file = "./.env") {
  if (!existsSync(file)) return false;
  process.loadEnvFile(file);
  return true;
}
