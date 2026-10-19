import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "activity-sign-in-"));
process.env.COOK_DATA_DIR = root;
const { default: authGuard } = await import("../../src/security/auth-guard.js");
const users = await import("../../src/security/users.js");
const { issuePasswordSession } = await import("../../src/security/user-session.js");
const { default: activityRouter } = await import("../../src/routes/activity.js");
users.add("owner", "owner-password-1", "admin");
users.add("viewer", "viewer-password-1", "user");
const app = express();
app.use(authGuard());
app.use("/api/activity", activityRouter({ list: () => ({ running: [{ title: "Test task" }], recent: [] }) }));
const server = app.listen(0, "127.0.0.1");
await new Promise(resolve => server.once("listening", resolve));
after(async () => {
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(root, { recursive: true, force: true });
});

test("activity keeps the sign-in wall and is readable by a signed-in non-admin user", async () => {
  const url = `http://127.0.0.1:${server.address().port}/api/activity`;
  assert.equal((await fetch(url, { headers: { Accept: "application/json" } })).status, 401);
  let cookie = "";
  issuePasswordSession({ secure: false, get: () => undefined, headers: {} }, {
    append: (_name, value) => { cookie = value.split(";")[0]; },
  }, "viewer");
  assert.equal(users.isAdmin("viewer"), false);
  const response = await fetch(url, { headers: { Accept: "application/json", Cookie: cookie } });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).running[0].title, "Test task");
});
