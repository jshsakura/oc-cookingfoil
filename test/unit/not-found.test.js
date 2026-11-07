import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { notFound } from "../../src/routes/not-found.js";

const app = express().use(notFound());
const server = app.listen(0);
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());
const get = (path, headers = {}) => fetch(base + path, { headers });

test("a browser gets a page in its language with a way on", async () => {
  const res = await get("/nope", { accept: "text/html", "accept-language": "ko" });
  assert.equal(res.status, 404);
  const body = await res.text();
  assert.match(body, /찾는 페이지가 없습니다/);
  assert.match(body, /href="\/"/);
  assert.ok(!body.includes("Cannot GET"));
});

test("an API caller gets JSON, under the admin too", async () => {
  for (const p of ["/api/nope", "/admin/api/nope"]) {
    const res = await get(p, { accept: "text/html" });
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: "not-found" });
  }
});

test("a console or curl gets the plain word, not a page to parse", async () => {
  const res = await get("/games/missing.nsp", { accept: "*/*" });
  assert.equal(res.status, 404);
  assert.equal(await res.text(), "Not Found\n");
});
