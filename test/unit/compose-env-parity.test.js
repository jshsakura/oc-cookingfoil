import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

// docker-compose used to forward only the variables it named, so a setting
// documented in .env.example but missing from the `environment:` block did
// nothing for Docker users (COOK_DEVICE_PAIRING and COOK_ADMIN_TOTP_SECRET once
// were unreachable that way). Now the whole .env is handed over with env_file;
// these tests keep it that way.

const ROOT = path.join(import.meta.dirname, "../..");
const compose = readFileSync(path.join(ROOT, "docker-compose.yml"), "utf-8");

// Fixed by the compose file's own volumes and port.
const FIXED = [
  "PUID", "PGID",
  "COOK_PORT", "COOK_GAMES_DIR", "COOK_DATA_DIR", "COOK_KEYS_DIR",
  "COOK_RETRO_DIR", "COOK_PATCHES_DIR", "COOK_SAVES_DIR", "COOK_HOMEBREW_DIR",
];

test("the whole .env reaches the container, in the short form older Compose releases read", () => {
  assert.match(compose, /env_file:\s*\n\s*- \.env\s*\n/);
});

test("no nested ${...} defaults: Compose before 2.20 (Synology) rejects them", () => {
  assert.doesNotMatch(compose, /\$\{[^}]*\$\{/);
});

test("only the paths and port the compose file fixes are set in environment:", () => {
  const listed = [...compose.matchAll(/^\s{6}(COOK_[A-Z0-9_]+|PUID|PGID):/gm)].map((m) => m[1]).sort();
  assert.deepEqual(listed, [...FIXED].sort(), "anything else listed there would override .env");
});

test("every folder is mounted beside the compose file unless its own COOK_<NAME>_PATH says otherwise", () => {
  const dirs = { games: "/games", data: "/data", keys: "/keys:ro", retro: "/retro", patches: "/patches", saves: "/saves", homebrew: "/homebrew" };
  for (const [name, target] of Object.entries(dirs)) {
    const line = `- \${COOK_${name.toUpperCase()}_PATH:-./${name}}:${target}`;
    assert.ok(compose.includes(line), line);
  }
});
