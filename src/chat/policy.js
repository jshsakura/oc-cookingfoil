/**
 * What the chat may do with each capability, decided by the server and never by the model.
 *
 *   auto     runs at once (searching, art, names, restores): metadata only, never a library file
 *   approve  shows a preview first; an admin approves with a button, anyone else sends a request
 *            the admin answers (Telegram)
 *   blocked  not offered and refused if called (every removal)
 *
 * A capability missing from the table is blocked, so a feature added later cannot start running on
 * its own. An upload's tier depends on what it does to the library, not on its capability id.
 */

const auto = (...ids) => ids.map((id) => [id, "auto"]);
const approve = (...ids) => ids.map((id) => [id, "approve"]);
const blocked = (...ids) => ids.map((id) => [id, "blocked"]);

export const DEFAULT_TIERS = Object.freeze(Object.fromEntries([
  ...auto(
    "help", "games_search", "game_get", "game_art", "game_art_search", "game_art_set", "game_art_crop",
    "retro_games_search", "retro_game_get", "retro_art_status", "retro_art_candidates", "retro_sgdb_search", "retro_sgdb_covers",
    "retro_art_sync", "retro_art_match", "retro_cover_set", "retro_ko_names", "retro_ko_name_decide", "retro_ko_index",
    "retro_cores", "retro_core_files", "retro_cores_fetch_missing", "retro_cores_update", "retro_requirements", "retro_rom_patches",
    "library_storage_guide", "library_folder_guide", "library_variants", "files_list", "image_optimize", "server_checkup", "upload_ticket", "upload_from_url", "homebrew_kind_set",
    "jobs_list", "server_status", "server_overview", "trash_list", "trash_journal", "trash_restore", "trash_undo",
    "plugin_list", "agent_list", "account_list", "device_list", "integration_list", "alerts_get", "settings_get", "games_wishlist", "games_wishlist_set",
  ),
  ...approve("settings_set", "integration_set", "account_set", "device_set", "sends_set", "alerts_set", "server_restart", "server_task", "retro_core_enabled", "retro_core_source", "retro_core_repo", "agent_order", "agent_clear", "upload_apply"),
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

const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const knownId = (v) => typeof v === "string" && v.length > 0;
const knownVersion = (v) => Number.isInteger(v) && v >= 0;

/**
 * What an incoming file does next to what the library holds: "add" (no such title), "update" (a
 * strictly higher version of a title it has) or "change" (anything else, including a title or
 * version that cannot be read). `held` is [{ identity, version }] from the library.
 */
export function classifyUpload(incoming, held) {
  if (!incoming || !knownId(incoming.identity)) return "change";
  const kin = (held ?? []).filter((h) => knownId(h.identity) && same(h.identity, incoming.identity));
  if (!knownVersion(incoming.version)) return "change";
  if (!kin.length) return "add";
  const top = Math.max(...kin.map((h) => (knownVersion(h.version) ? h.version : -1)));
  return incoming.version > top ? "update" : "change";
}

/** Files one chat call may add on its own; a larger batch waits for an approval. */
export const MAX_AUTO_FILES = 5;

/** The tier of an upload call from its files' classes. */
export function uploadTier(classes) {
  if (!classes.length || classes.length > MAX_AUTO_FILES) return "approve";
  return classes.every((c) => c === "add" || c === "update") ? "auto" : "approve";
}
