import { test } from "node:test";
import assert from "node:assert/strict";

const { DEFAULT_TIERS, tierOf, decide, classifyUpload, uploadTier, MAX_AUTO_FILES } = await import("../../src/chat/policy.js");

test("a capability the table does not list is blocked", () => {
  assert.equal(tierOf("something_new_and_unlisted"), "blocked");
  assert.equal(tierOf(undefined), "blocked");
  assert.equal(tierOf("__proto__"), "blocked");
  assert.equal(tierOf("constructor"), "blocked");
});

test("searching, art, names and restores run on their own", () => {
  for (const id of ["games_search", "retro_games_search", "game_get", "game_art_search", "game_art_set", "game_art_crop", "retro_cover_set", "retro_ko_name_decide", "trash_restore", "jobs_list"]) {
    assert.equal(tierOf(id), "auto", id);
  }
});

test("every kind of removal is blocked in chat", () => {
  for (const id of ["library_files_remove", "patches_remove", "game_art_remove", "trash_release", "job_cancel"]) {
    assert.equal(tierOf(id), "blocked", id);
  }
});

test("settings, accounts, devices and restart need an approval", () => {
  for (const id of ["settings_set", "integration_set", "account_set", "device_set", "server_restart"]) {
    assert.equal(tierOf(id), "approve", id);
  }
});

test("the table only names tiers that exist", () => {
  for (const [id, tier] of Object.entries(DEFAULT_TIERS)) assert.ok(["auto", "approve", "blocked"].includes(tier), `${id}: ${tier}`);
});

test("decide: auto runs, blocked is denied, approve asks the person or the admin", () => {
  assert.equal(decide("auto", { admin: false }), "run");
  assert.equal(decide("auto", { admin: true }), "run");
  assert.equal(decide("blocked", { admin: true }), "deny");
  assert.equal(decide("approve", { admin: true }), "preview");
  assert.equal(decide("approve", { admin: false }), "request");
  assert.equal(decide("nonsense", { admin: true }), "deny");
});

const have = [{ identity: "0100AAAA00000000", version: 65536 }];

test("classifyUpload: no such title yet is an add", () => {
  assert.equal(classifyUpload({ identity: "0100BBBB00000000", version: 0 }, have), "add");
  assert.equal(classifyUpload({ identity: "0100BBBB00000000", version: 0 }, []), "add");
});

test("classifyUpload: only a strictly higher version is an update", () => {
  assert.equal(classifyUpload({ identity: "0100AAAA00000000", version: 131072 }, have), "update");
  assert.equal(classifyUpload({ identity: "0100AAAA00000000", version: 65536 }, have), "change");
  assert.equal(classifyUpload({ identity: "0100AAAA00000000", version: 0 }, have), "change");
});

test("classifyUpload: the highest version already held decides", () => {
  const several = [{ identity: "0100AAAA00000000", version: 65536 }, { identity: "0100AAAA00000000", version: 196608 }];
  assert.equal(classifyUpload({ identity: "0100AAAA00000000", version: 131072 }, several), "change");
  assert.equal(classifyUpload({ identity: "0100AAAA00000000", version: 262144 }, several), "update");
});

test("classifyUpload: an unknown identity or version is never an add or an update", () => {
  assert.equal(classifyUpload({ identity: null, version: 1 }, have), "change");
  assert.equal(classifyUpload({ identity: "", version: 1 }, have), "change");
  assert.equal(classifyUpload({ identity: "0100AAAA00000000", version: null }, have), "change");
  assert.equal(classifyUpload({ identity: "0100AAAA00000000", version: "2" }, have), "change");
  assert.equal(classifyUpload({ identity: "0100BBBB00000000", version: null }, have), "change");
  assert.equal(classifyUpload(null, have), "change");
});

test("classifyUpload: identities compare without regard to case", () => {
  assert.equal(classifyUpload({ identity: "0100aaaa00000000", version: 131072 }, have), "update");
  assert.equal(classifyUpload({ identity: "0100aaaa00000000", version: 65536 }, have), "change");
});

test("uploadTier: adds and updates run on their own, anything else needs an approval", () => {
  assert.equal(uploadTier(["add"]), "auto");
  assert.equal(uploadTier(["add", "update"]), "auto");
  assert.equal(uploadTier(["add", "change"]), "approve");
  assert.equal(uploadTier([]), "approve");
});

test("uploadTier: a batch past the cap needs an approval even when every file is new", () => {
  assert.equal(uploadTier(Array(MAX_AUTO_FILES).fill("add")), "auto");
  assert.equal(uploadTier(Array(MAX_AUTO_FILES + 1).fill("add")), "approve");
});

// Drift guard: a capability added to the registry must be given a tier on purpose. Unlisted ones are
// blocked in chat, which is safe but silent, so the list below names every one that is left out.
const { mkdtempSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const path = await import("node:path");
process.env.COOK_DATA_DIR ??= mkdtempSync(path.join(tmpdir(), "cook-chat-policy-"));
const { registry } = await import("../../src/capabilities/registry.js");

test("every capability the registry serves has a tier, or is left out of chat on purpose", () => {
  const LEFT_OUT = new Set([]);
  const unlisted = registry.all.map((c) => c.id).filter((id) => !Object.hasOwn(DEFAULT_TIERS, id) && !LEFT_OUT.has(id));
  assert.deepEqual(unlisted, [], `give these a tier in src/chat/policy.js (or list them in LEFT_OUT): ${unlisted.join(", ")}`);
});

test("the table names no capability that does not exist", () => {
  const ids = new Set(registry.all.map((c) => c.id));
  const NOT_YET = new Set(["upload_apply", "image_optimize", "server_checkup", "upload_ticket", "upload_from_url", "homebrew_kind_set"]);
  const stale = Object.keys(DEFAULT_TIERS).filter((id) => !ids.has(id) && !NOT_YET.has(id));
  assert.deepEqual(stale, [], `no such capability: ${stale.join(", ")}`);
});
