import { test } from "node:test";
import assert from "node:assert/strict";

const { DEFAULT_TIERS, tierOf, decide, AUTO_WRITES } = await import("../../src/chat/policy.js");

test("a capability the table does not list is blocked", () => {
  assert.equal(tierOf("something_new_and_unlisted"), "blocked");
  assert.equal(tierOf(undefined), "blocked");
  assert.equal(tierOf("__proto__"), "blocked");
  assert.equal(tierOf("constructor"), "blocked");
});

test("searching and listing run on their own", () => {
  for (const id of ["games_search", "retro_games_search", "game_get", "game_art_search", "jobs_list", "games_wishlist"]) {
    assert.equal(tierOf(id), "auto", id);
  }
});

test("art, names, restores and downloads of core files need an approval", () => {
  for (const id of ["game_art_set", "game_art_crop", "retro_art_sync", "retro_cover_set", "retro_ko_name_decide", "trash_restore", "retro_cores_update", "retro_cores_fetch_missing"]) {
    assert.equal(tierOf(id), "approve", id);
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
  const stale = Object.keys(DEFAULT_TIERS).filter((id) => !ids.has(id));
  assert.deepEqual(stale, [], `no such capability: ${stale.join(", ")}`);
});

test("only a read runs without an approval, unless AUTO_WRITES says why a write may", () => {
  const safety = new Map(registry.all.map((c) => [c.id, c.safety]));
  const writesOnTheirOwn = Object.entries(DEFAULT_TIERS)
    .filter(([id, tier]) => tier === "auto" && safety.get(id) !== "read" && !Object.hasOwn(AUTO_WRITES, id))
    .map(([id]) => id);
  assert.deepEqual(writesOnTheirOwn, [], `a write needs an approval, or a reason in AUTO_WRITES: ${writesOnTheirOwn.join(", ")}`);
  for (const [id, why] of Object.entries(AUTO_WRITES)) {
    assert.equal(DEFAULT_TIERS[id], "auto", `${id} is listed in AUTO_WRITES but is not auto`);
    assert.ok(why.length > 10, `${id} needs a reason`);
  }
});
