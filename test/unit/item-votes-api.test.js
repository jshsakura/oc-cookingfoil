import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { adminSession, webSession } from "../support/web-session.js";

// 잘 돼요 / 안 돼요 through /api/votes: who may vote, what the lists carry, and the admin's clear.
const PORT = 22600 + (process.pid % 500);
const BASE = `http://127.0.0.1:${PORT}`;
const KEY = "CD".repeat(32);
const TID = "0100000000010000";

async function boot() {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "cf-votes-api-"));
  const put = (rel, body) => {
    fs.mkdirSync(path.dirname(path.join(data, rel)), { recursive: true });
    fs.writeFileSync(path.join(data, rel), body);
  };
  put(`games/Test Game [${TID}][v0].nsp`, "");
  put(`patches/${TID}/Korean/atmosphere/contents/${TID}/romfs/a.bin`, "aaaa");
  put(`saves/${TID}/All Unlocked/save.dat`, "SAVE");
  const child = spawn(process.execPath, ["./src/index.js"], {
    cwd: path.join(import.meta.dirname, "../.."),
    env: { ...process.env, COOK_PORT: String(PORT), COOK_DATA_DIR: data, COOK_GAMES_DIR: path.join(data, "games"),
      COOK_PATCHES_DIR: path.join(data, "patches"), COOK_SAVES_DIR: path.join(data, "saves"), COOK_HOMEBREW_DIR: path.join(data, "hb"),
      COOK_HOMEBREW_REPOS: "", COOK_RETRO_DIR: path.join(data, "retro"), COOK_RETRO_META: "false",
      COOK_AUTH_USERS: "alice:alice-password,bob:bob-password", COOK_ADMIN_PASSWORD: "admin-password-123", COOK_DEVICE_PAIRING: "true",
      COOK_TITLEDB_AUTO_FETCH: "false", COOK_UPLOADS_ENABLED: "true" },
    stdio: "ignore",
  });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/healthz`)).ok) return { child, data };
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  child.kill("SIGKILL");
  throw new Error("server did not start");
}

test("accounts and consoles vote once each per item, the lists carry the counts and my_vote, and the admin clears them", async () => {
  const { child, data } = await boot();
  try {
    const A = { ...(await adminSession(BASE, "alice", "alice-password", "admin-password-123")), "Content-Type": "application/json" };
    const B = { ...(await webSession(BASE, "bob", "bob-password")), "Content-Type": "application/json" };
    const call = (headers) => async (method, p, body) =>
      fetch(`${BASE}${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const alice = call(A);
    const bob = call(B);
    const pending = await (await fetch(`${BASE}/api/pair/status`, { headers: { "X-Device-Key": KEY } })).json();
    assert.equal((await alice("POST", "/admin/api/devices/approve", { code: pending.pairCode, label: "거실" })).status, 200);
    const { accessKey } = await (await fetch(`${BASE}/api/pair/status`, { headers: { "X-Device-Key": KEY } })).json();
    const console1 = call({ "X-Device-Key": KEY, "X-Access-Key": accessKey, "Content-Type": "application/json" });

    let patch;
    for (let i = 0; i < 40 && !patch; i++) {
      patch = (await (await console1("GET", "/api/patches")).json()).patches.find((p) => p.name === "Korean");
      if (!patch) await new Promise((r) => setTimeout(r, 250));
    }
    assert.deepEqual([patch.votes, patch.my_vote], [{ up: 0, down: 0 }, null]);
    const save = (await (await console1("GET", "/api/saves")).json()).saves.find((s) => s.name === "All Unlocked");
    assert.deepEqual([save.votes, save.my_vote], [{ up: 0, down: 0 }, null]);
    const P = `/api/votes/patch/${patch.id}`;

    // Nobody to vote as.
    const anon = await fetch(`${BASE}${P}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ vote: "up" }) });
    assert.equal(anon.status, 401);
    // Bad value, unknown kind or item.
    assert.equal((await bob("POST", P, { vote: "meh" })).status, 400);
    assert.equal((await bob("POST", P, {})).status, 400);
    assert.equal((await bob("POST", `/api/votes/game/${TID}`, { vote: "up" })).status, 404);
    assert.equal((await bob("POST", `/api/votes/patch/${TID}-000000000000`, { vote: "up" })).status, 404);
    assert.equal((await bob("GET", `/api/votes/save/${TID}-000000000000`)).status, 404);
    // Another site's page cannot vote with bob's cookie.
    assert.equal((await call({ ...B, Origin: "https://example.org" })("POST", P, { vote: "up" })).status, 403);

    // Each voter counts once; changing replaces.
    assert.deepEqual(await (await console1("POST", P, { vote: "up" })).json(), { up: 1, down: 0, mine: "up" });
    assert.deepEqual(await (await bob("POST", P, { vote: "up" })).json(), { up: 2, down: 0, mine: "up" });
    assert.deepEqual(await (await bob("POST", P, { vote: "up" })).json(), { up: 2, down: 0, mine: "up" }, "the same vote twice counts once");
    assert.deepEqual(await (await alice("POST", P, { vote: "down" })).json(), { up: 2, down: 1, mine: "down" }, "an admin votes as their account");
    assert.deepEqual(await (await bob("POST", P, { vote: "down" })).json(), { up: 1, down: 2, mine: "down" });
    assert.deepEqual(await (await console1("GET", P)).json(), { up: 1, down: 2, mine: "up" });

    // The lists carry the counts and each requester's own vote.
    const listedFor = async (who) => (await (await who("GET", "/api/patches")).json()).patches.find((p) => p.id === patch.id);
    assert.deepEqual([(await listedFor(console1)).votes, (await listedFor(console1)).my_vote], [{ up: 1, down: 2 }, "up"]);
    assert.equal((await listedFor(bob)).my_vote, "down");
    assert.deepEqual(await (await bob("POST", P, { vote: null })).json(), { up: 1, down: 1, mine: null });
    assert.equal((await listedFor(bob)).my_vote, null);

    assert.deepEqual(await (await console1("POST", `/api/votes/save/${save.id}`, { vote: "down" })).json(), { up: 0, down: 1, mine: "down" });
    const saved = (await (await console1("GET", "/api/saves")).json()).saves.find((s) => s.id === save.id);
    assert.deepEqual([saved.votes, saved.my_vote], [{ up: 0, down: 1 }, "down"]);
    const stored = JSON.stringify(JSON.parse(fs.readFileSync(path.join(data, "item-votes.json"), "utf8")));
    assert.ok(!stored.includes(KEY), "the console's key is not written down");

    // The admin clears an item's votes; removing an item forgets them.
    assert.equal((await alice("POST", "/admin/api/votes/clear", { kind: "nope", id: patch.id })).status, 404);
    assert.equal((await bob("POST", "/admin/api/votes/clear", { kind: "patch", id: patch.id })).status, 403, "not an admin");
    assert.equal((await alice("POST", "/admin/api/votes/clear", { kind: "patch", id: patch.id })).status, 200);
    assert.deepEqual(await (await console1("GET", P)).json(), { up: 0, down: 0, mine: null });
    assert.equal((await alice("POST", "/admin/api/content/save/remove", { id: save.id })).status, 200);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(data, "item-votes.json"), "utf8")), {});
  } finally {
    child.kill("SIGKILL");
  }
});
