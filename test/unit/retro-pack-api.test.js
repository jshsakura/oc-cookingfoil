import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

const base = fs.mkdtempSync(path.join(os.tmpdir(), "retro-pack-api-"));
process.env.COOK_DATA_DIR = path.join(base, "data");
process.env.COOK_RETRO_DIR = path.join(base, "retro");
process.env.COOK_GAMES_DIR = path.join(base, "games");
fs.mkdirSync(process.env.COOK_RETRO_DIR, { recursive: true });
fs.mkdirSync(process.env.COOK_GAMES_DIR, { recursive: true });

const { mountRetroPackApi } = await import("../../src/routes/admin/retro-pack-api.js");
const { openDatabase, SECURITY_MIGRATIONS } = await import("../../src/db/database.js");
const { packLedger } = await import("../../src/db/security-stores.js");

function mount() {
  const routes = {};
  const router = { get: (p, h) => (routes[`GET ${p}`] = h), post: (p, h) => (routes[`POST ${p}`] = h) };
  // The download never answers, so a started job stays running.
  const fetchImpl = () => new Promise(() => {});
  mountRetroPackApi(router, () => true, { ledger: () => packLedger({ db: openDatabase(":memory:", { migrations: SECURITY_MIGRATIONS }) }), fetchImpl });
  return routes;
}
// Resolves when the handler answers; a started job keeps running after that, so the handler itself may never return.
const call = (handler, body = {}) => new Promise((resolve, reject) => {
  const out = { status: 200, body: null };
  const res = { set() { return this; }, status(c) { out.status = c; return this; }, json(b) { out.body = b; resolve(out); return this; } };
  Promise.resolve(handler({ body, query: {} }, res)).catch(reject);
});

test("a recovery note makes the start request a 409 at once, not a 202 that fails later", async () => {
  const routes = mount();
  const note = path.join(process.env.COOK_DATA_DIR, "retro-pack-recovery.json");
  fs.mkdirSync(process.env.COOK_DATA_DIR, { recursive: true });
  fs.writeFileSync(note, JSON.stringify({ stuck: ["retroarch.nro"] }));
  try {
    const r = await call(routes["POST /api/retro-pack/fill"], { confirm: true });
    assert.equal(r.status, 409);
    assert.deepEqual(r.body.stuck, ["retroarch.nro"]);
  } finally { fs.rmSync(note, { force: true }); }
});

test("F2: two simultaneous start requests: one 202, one 409, and the first job's display is not replaced", async () => {
  const routes = mount();
  const [a, b] = await Promise.all([call(routes["POST /api/retro-pack/fill"], { confirm: true }), call(routes["POST /api/retro-pack/fill"], { confirm: true })]);
  assert.deepEqual([a.status, b.status].sort(), [202, 409]);
  const first = [a, b].find((r) => r.status === 202).body.job;
  const view = await call(routes["GET /api/retro-pack"]);
  assert.equal(view.body.busy, true);
  assert.equal(view.body.job.startedAt, first.startedAt);
  assert.equal(view.body.job.error, undefined);
});
