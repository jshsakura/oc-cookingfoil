/**
 * What the chat may do with each capability, decided by the server and never by the model.
 *
 *   auto     runs at once: a read, or a write named in AUTO_WRITES with its reason
 *   approve  every other write; shows a preview first; an admin approves with a button, anyone else sends a request
 *            the admin answers (Telegram)
 *   blocked  not offered and refused if called (every removal)
 *
 * A capability missing from the table is blocked, so a feature added later cannot start running on
 * its own.
 */

const auto = (...ids) => ids.map((id) => [id, "auto"]);
const approve = (...ids) => ids.map((id) => [id, "approve"]);
const blocked = (...ids) => ids.map((id) => [id, "blocked"]);

/** The only writes that run without an approval, each with the reason. Every other write waits for one. */
export const AUTO_WRITES = Object.freeze({
  games_wishlist_set: "changes only the caller's own wishlist and is undone by the opposite call",
});

export const DEFAULT_TIERS = Object.freeze(Object.fromEntries([
  ...auto(
    "help", "games_search", "game_get", "game_art_search", "retro_games_search", "retro_game_get", "retro_art_status",
    "retro_art_candidates", "retro_sgdb_search", "retro_sgdb_covers", "retro_ko_names", "retro_cores", "retro_core_files",
    "retro_requirements", "retro_rom_patches", "library_storage_guide", "library_folder_guide", "library_variants", "files_list",
    "jobs_list", "server_status", "server_overview", "trash_list", "trash_journal", "plugin_list", "agent_list", "account_list",
    "device_list", "integration_list", "alerts_get", "settings_get", "games_wishlist", "game_art",
    ...Object.keys(AUTO_WRITES),
  ),
  ...approve(
    "game_art_set", "game_art_crop", "retro_art_sync", "retro_art_match", "retro_cover_set", "retro_ko_name_decide", "retro_ko_index",
    "retro_cores_fetch_missing", "retro_cores_update", "trash_restore", "trash_undo",
    "settings_set", "integration_set", "account_set", "device_set", "sends_set", "alerts_set", "server_restart", "server_task",
    "retro_core_enabled", "retro_core_source", "retro_core_repo", "agent_order", "agent_clear",
  ),
  ...blocked("library_files_remove", "patches_remove", "game_art_remove", "trash_release", "job_cancel"),
]));

const TIERS = new Set(["auto", "approve", "blocked"]);

/** The tier of a capability id; anything the table does not list is blocked. */
export function tierOf(id, table = DEFAULT_TIERS) {
  if (typeof id !== "string" || !Object.hasOwn(table, id)) return "blocked";
  return TIERS.has(table[id]) ? table[id] : "blocked";
}

/** What the chat does with a call of this tier: run, preview (the admin approves), request (an admin is asked) or deny. */
export function decide(tier, { admin }) {
  if (tier === "auto") return "run";
  if (tier === "approve") return admin ? "preview" : "request";
  return "deny";
}
