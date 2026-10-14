import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import webAssets, { ASSET_CACHE_CONTROL } from "../../src/routes/web-assets.js";

const servers = [];
after(() => servers.forEach((s) => s.close()));

test("/assets are cached by the browser only, for an hour", async () => {
  const app = express();
  app.use("/assets", webAssets);
  const server = http.createServer(app);
  servers.push(server);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const res = await fetch(`http://127.0.0.1:${server.address().port}/assets/cookingfoil.svg`);
  assert.equal(res.status, 200);
  assert.equal(ASSET_CACHE_CONTROL, "private, max-age=3600");
  assert.equal(res.headers.get("cache-control"), "private, max-age=3600");
  assert.ok(res.headers.get("etag"), "revalidated by its ETag after the hour");
});
