#!/usr/bin/env node
// Best-effort installer for repo-managed git hooks.
// - Silent no-op outside a git checkout (Docker build, tarball install, ...).
// - Runs as `postinstall` so `npm install` in a dev clone auto-arms the hook.
// - CI / Docker use `npm ci --ignore-scripts`, so this won't fire there.
const { execSync } = require("node:child_process");

let inRepo = true;
try {
  execSync("git rev-parse --git-dir", { stdio: "ignore" });
} catch {
  inRepo = false;
}
if (!inRepo) process.exit(0);

try {
  execSync("git config core.hooksPath .githooks", { stdio: "ignore" });
  console.log("✓ git hooks installed (.githooks)");
} catch (err) {
  console.warn("hooks install skipped:", err.message);
}
