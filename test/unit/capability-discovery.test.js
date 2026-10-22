import { test } from "node:test";
import assert from "node:assert/strict";

// Route discovery starts the real app and reads its router, so no way of registering a route can
// slip past the coverage test unseen.
const { discoverRoutes } = await import("../support/capability-routes.js");

const FIXTURE = new URL("../support/capability-routes-app.js", import.meta.url);

test("discovery sees routes however they are registered", () => {
  const routes = discoverRoutes({ entry: FIXTURE });
  assert.deepEqual(routes, [
    "ALL /api/e5",
    "DELETE /api/e11",
    "GET /api/e1",
    "GET /api/e14/",
    "GET /api/e4",
    "HEAD /api/e13",
    "OPTIONS /api/e13",
    "PATCH /api/e12",
    "POST /api/e4",
    "PUT /api/e3",
  ]);
});
