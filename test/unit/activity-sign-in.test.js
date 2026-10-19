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
const { default: adminPageRouter } = await import("../../src/routes/admin-page.js");
const activity = await import("../../src/tasks/activity.js");
users.add("owner", "owner-password-1", "admin");
users.add("viewer", "viewer-password-1", "user");
const app = express();
app.use(authGuard());
app.use("/api/activity", activityRouter({ list: () => ({ running: [{ title: "Test task" }], recent: [] }) }));
app.use("/admin", adminPageRouter());
const server = app.listen(0, "127.0.0.1");
await new Promise(resolve => server.once("listening", resolve));
after(async () => {
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(root, { recursive: true, force: true });
});

/** The cookie a browser signed in as `name` at /login carries. */
function signedIn(name) {
  let cookie = "";
  issuePasswordSession({ secure: false, get: () => undefined, headers: {} }, {
    append: (_name, value) => { cookie = value.split(";")[0]; },
  }, name);
  return cookie;
}

test("activity keeps the sign-in wall and is readable by a signed-in non-admin user", async () => {
  const url = `http://127.0.0.1:${server.address().port}/api/activity`;
  assert.equal((await fetch(url, { headers: { Accept: "application/json" } })).status, 401);
  const cookie = signedIn("viewer");
  assert.equal(users.isAdmin("viewer"), false);
  const response = await fetch(url, { headers: { Accept: "application/json", Cookie: cookie } });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).running[0].title, "Test task");
});

test("a signed-in non-admin account cannot stop a task through the admin API", async () => {
  let cancelled = 0;
  const job = activity.begin("nsz", { title: "Test conversion", total: 100, cancel: () => cancelled++ });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${base}/admin/api/activity/${job.id}/cancel`, {
      method: "POST", headers: { Accept: "application/json", Origin: base, Cookie: signedIn("viewer") },
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error, "admin accounts only");
    assert.equal(cancelled, 0);
    assert.ok(activity.list().running.some((e) => e.id === job.id), "the task keeps running");
  } finally {
    job.discard();
  }
});
