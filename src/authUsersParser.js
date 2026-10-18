import { authUsers } from "./helpers/envs.js";
import debug from "./debug.js";

/**
 * COOK_AUTH_USERS as { name: password }. Only the first colon separates name and
 * password, so passwords may contain ':'. An entry without a colon has no password
 * and is skipped with a log line rather than read as some other account.
 */
export function getUsersFromEnv() {
  if (!authUsers) return null;
  const parsed = {};
  for (const entry of authUsers.split(",")) {
    if (!entry.trim()) continue;
    const sep = entry.indexOf(":");
    if (sep < 0) {
      debug.error("users: skipped COOK_AUTH_USERS entry %O, write it as name:password", entry.trim());
      continue;
    }
    parsed[entry.slice(0, sep).trim()] = entry.slice(sep + 1).trim();
  }
  debug.log("Auth Users Loaded: %O", Object.keys(parsed).join(","));
  return Object.keys(parsed).length ? parsed : null;
}
