import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { downloadSecurityHistory } from "../../src/helpers/download-security-history.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "edge-history-"));
const file = path.join(dir, "download-security.json");
after(() => fs.rmSync(dir, { recursive: true, force: true }));
const event = {
  at: 1_700_000_000_000, action: "blocked", reason: "cookingfoil/dl-bad-link", count: 15,
  until: 1_700_000_600_000, delivery: "failed",
  users: [{ owner: "alice", label: "Living room", device: "ab12cd34", match: "request" }],
};
const put = (events) => fs.writeFileSync(file, JSON.stringify({ events }));

test("a firewall ban remains visible with its user and expiry when Telegram fails", () => {
  put([event]);
  const [entry] = downloadSecurityHistory("en", file);
  assert.match(entry.text, /Download automatically blocked: alice \/ Living room \/ ab12cd34/);
  assert.match(entry.text, /cookingfoil\/dl-bad-link/);
  assert.match(entry.text, /2023-11-14T22:23:20.000Z/);
  assert.equal(entry.status, "failed");
});

test("shared-address candidates are distinguished from proven requesters in all languages", () => {
  put([{ ...event, users: [{ ...event.users[0], match: "recent-address" }] }]);
  for (const lang of ["ko", "en", "ja", "zh"]) {
    const [entry] = downloadSecurityHistory(lang, file);
    assert.match(entry.text, /alice/);
    assert.notEqual(entry.text, "edgeSummary");
    assert.ok(entry.text.includes("("));
  }
});

test("a removed ban updates the dashboard even without a Telegram configuration", () => {
  put([{ ...event, action: "released", until: null, updatedAt: event.at + 1000, delivery: "off", users: [] }]);
  const [entry] = downloadSecurityHistory("en", file);
  assert.equal(entry.at, event.at + 1000);
  assert.match(entry.text, /block removed/i);
  assert.match(entry.text, /User could not be identified/);
  assert.match(entry.text, /No active block/);
});

test("missing and invalid external histories never break the admin page", () => {
  assert.deepEqual(downloadSecurityHistory("en", path.join(dir, "absent")), []);
  fs.writeFileSync(file, "{");
  assert.deepEqual(downloadSecurityHistory("en", file), []);
  put([{}, { ...event, action: "invented" }]);
  assert.deepEqual(downloadSecurityHistory("en", file), []);
});
