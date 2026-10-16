import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// The connection hints ride on lists and downloads. How many consoles are
// downloading right now goes only to a request the guards after it let through.
process.env.COOK_DATA_DIR = mkdtempSync(path.join(tmpdir(), "cook-hint-"));
const express = (await import("express")).default;
const { default: connectionHint, ACTIVE_DOWNLOADS_HEADER, MAX_CONNECTIONS_HEADER } = await import("../../src/helpers/connection-hint.js");

const servers = [];
after(() => { for (const s of servers) { s.closeAllConnections?.(); s.close(); } });

test("a request a later guard refuses never learns how many consoles are downloading", async () => {
  const app = express();
  app.use(connectionHint());
  // Stands in for deviceContentGuard on a pairing-only shop.
  app.use((req, res, next) => (req.get("x-device-key") === "approved" ? next() : res.status(403).send("Device not approved.")));
  app.get("/shop.json", (_req, res) => res.json({ files: [] }));
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const refused = await fetch(`${base}/shop.json`, { headers: { "X-Device-Key": "stranger" } });
  assert.equal(refused.status, 403);
  assert.equal(refused.headers.get(ACTIVE_DOWNLOADS_HEADER), null);

  const ok = await fetch(`${base}/shop.json`, { headers: { "X-Device-Key": "approved" } });
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get(ACTIVE_DOWNLOADS_HEADER) ?? "", /^\d+$/);
  assert.match(ok.headers.get(MAX_CONNECTIONS_HEADER) ?? "", /^\d+$/);
});
