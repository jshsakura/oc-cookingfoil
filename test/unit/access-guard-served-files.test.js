import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// The probe filter's script-extension rule: a request for a real file in the
// games folder (a mod's install.sh, a patch's .py) is content, not a probe, so
// fetching it never counts toward the lockout. Made-up script paths still do.
const root = fs.mkdtempSync(path.join(tmpdir(), "cook-access-served-"));
const games = path.join(root, "games");
fs.mkdirSync(path.join(games, "Some Game", "mods"), { recursive: true });
fs.writeFileSync(path.join(games, "Some Game", "mods", "install.sh"), "#!/bin/sh\n");
fs.writeFileSync(path.join(games, "patch.py"), "print(1)\n");
process.env.COOK_DATA_DIR = path.join(root, "data");
process.env.COOK_GAMES_DIR = games;
process.env.COOK_LOCKOUT_TRUST_LOOPBACK = "false";
const { default: accessGuard } = await import("../../src/security/access-guard.js");
const store = await import("../../src/security/store.js");

function hit(ip, urlPath) {
  const req = {
    ip, socket: { remoteAddress: ip }, method: "GET", path: urlPath, originalUrl: urlPath, headers: {},
    get(n) { return this.headers[String(n).toLowerCase()]; },
  };
  const res = { statusCode: 200, headers: {}, set(k, v) { this.headers[k] = v; return this; }, setHeader(k, v) { return this.set(k, v); },
    status(c) { this.statusCode = c; return this; }, type() { return this; }, send() { return this; }, end() { return this; }, json() { return this; } };
  let passed = false;
  accessGuard()(req, res, () => { passed = true; });
  return { passed, status: res.statusCode };
}

test("real library files with script extensions pass and never lock the address", () => {
  const ip = "203.0.113.21";
  for (let i = 0; i < 8; i++) {
    assert.equal(hit(ip, "/Some%20Game/mods/install.sh").passed, true);
    assert.equal(hit(ip, "/patch.py").passed, true);
    assert.equal(hit(ip, "/api/retro/base-pack/file/retroarch/x.py").passed, true, "an API route judges its own paths");
  }
  assert.equal(store.getFailure(ip), null, "nothing counted");
  assert.equal(store.isLocked(ip), false);
});

test("script paths that are not served content still count as probes", () => {
  const ip = "203.0.113.22";
  for (const p of ["/shell.php", "/Some%20Game/mods/missing.sh", "/x.cgi", "/../games/patch.py"]) {
    assert.equal(hit(ip, p).passed, false, p);
  }
  assert.ok(store.getFailure(ip)?.count >= 4);
});
