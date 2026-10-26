import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import activityRouter from "../../src/routes/activity.js";
import { createActivity } from "../../src/tasks/activity.js";

test("library users can read running and recent tasks but the public activity API cannot stop them", async () => {
  const registry = createActivity();
  let cancelled = 0;
  const job = registry.begin("nsz", { title: "Test conversion", total: 100, cancel: () => cancelled++ });
  job.step(25, "Test game");
  registry.begin("backup", { title: "Test backup" }).done("Done");
  const app = express();
  app.use("/api/activity", activityRouter(registry));
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/activity`;
  try {
    const response = await fetch(base);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.json();
    assert.equal(body.running[0].title, "Test conversion");
    assert.equal(body.running[0].current, 25);
    assert.equal(body.recent[0].state, "done");
    for (const method of ["POST", "DELETE", "PUT"]) {
      assert.equal((await fetch(`${base}/${job.id}/cancel`, { method })).status, 404);
    }
    assert.equal(cancelled, 0);
    assert.equal(registry.list().running.length, 1);
  } finally {
    job.discard();
    await new Promise(resolve => server.close(resolve));
  }
});
