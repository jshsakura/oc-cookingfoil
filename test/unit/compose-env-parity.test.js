import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

// docker-compose only forwards the variables it names explicitly. A setting
// documented in .env.example but missing from the compose `environment:` block
// silently does NOTHING for every Docker user — which is how COOK_DEVICE_PAIRING
// and COOK_ADMIN_TOTP_SECRET came to be unreachable in production.

const ROOT = path.join(import.meta.dirname, "../..");
const envExample = readFileSync(path.join(ROOT, ".env.example"), "utf-8");
const compose = readFileSync(path.join(ROOT, "docker-compose.yml"), "utf-8");

// Fixed by the image itself (paths + port inside the container), or only
// consumed by the local test harnesses that never run in Docker.
const NOT_APPLICABLE = new Set([
  "COOK_PORT",
  "COOK_HOST_PORT",
  "COOK_GAMES_DIR",
  "COOK_DATA_DIR",
  "COOK_KEYS_DIR",
  "COOK_LOCAL_DEVICES",
  "COOK_LOCAL_GAMES_DIR",
  "COOK_LOCAL_KEEP_DATA",
  "COOK_LOCAL_VERBOSE",
]);

function documentedVars() {
  const found = new Set();
  for (const line of envExample.split("\n")) {
    const m = line.match(/^#?\s*(COOK_[A-Z0-9_]+)=/);
    if (m) found.add(m[1]);
  }
  return [...found].filter((v) => !NOT_APPLICABLE.has(v)).sort();
}

function forwardedVars() {
  const found = new Set();
  for (const m of compose.matchAll(/^\s{6}(COOK_[A-Z0-9_]+):/gm)) found.add(m[1]);
  return found;
}

test("every documented COOK_* setting is forwarded by docker-compose", () => {
  const forwarded = forwardedVars();
  const missing = documentedVars().filter((v) => !forwarded.has(v));

  assert.deepEqual(
    missing,
    [],
    `these are documented in .env.example but never reach the container:\n  ${missing.join("\n  ")}`
  );
});

test("the pairing + admin settings specifically are forwarded", () => {
  // Called out on their own: without these, /admin 404s and device pairing
  // stays off no matter what the operator writes in .env.
  const forwarded = forwardedVars();
  for (const key of [
    "COOK_DEVICE_PAIRING",
    "COOK_ADMIN_TOTP_SECRET",
    "COOK_ADMIN_EMAIL",
    "COOK_ADMIN_TOKEN",
    "COOK_AUTH_USERS",
  ]) {
    assert.ok(forwarded.has(key), `${key} must be listed in docker-compose.yml`);
  }
});

test("forwarded vars default to empty rather than baking a value into the image", () => {
  // `${VAR:-}` keeps an unset variable unset. A hardcoded default here would
  // silently override .env for everyone.
  for (const m of compose.matchAll(/^\s{6}(COOK_[A-Z0-9_]+):\s*(.+)$/gm)) {
    const [, key, value] = m;
    if (["COOK_PORT", "COOK_GAMES_DIR", "COOK_DATA_DIR", "COOK_KEYS_DIR"].includes(key)) continue;
    assert.match(
      value.trim(),
      /^\$\{[A-Z0-9_]+(:-.*)?\}$/,
      `${key} should be forwarded as \${${key}:-…}, got: ${value.trim()}`
    );
  }
});
