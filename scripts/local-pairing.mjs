#!/usr/bin/env node
/**
 * Local pairing + basic-auth harness — one command boots a testable server.
 *
 *   npm run test:pairing
 *   node scripts/local-pairing.mjs
 *
 * Reads the SAME .env the server uses (COOK_PORT / COOK_AUTH_USERS /
 * COOK_ADMIN_TOTP_SECRET / …) plus a few COOK_LOCAL_* test knobs, boots the real
 * server with COOK_DEVICE_PAIRING forced on and a fresh temp data dir, then:
 *   - prints the server + admin URLs and the LIVE admin TOTP code,
 *   - if COOK_LOCAL_DEVICES is set: pre-approves each device and prints its
 *     one-time accessKey so you can curl /shop.tfl immediately,
 *   - prints ready-to-paste curl examples for whichever lanes are on.
 *
 * Ctrl+C tears the server down (and the temp data dir unless COOK_LOCAL_KEEP_DATA).
 */
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { generate } from "otplib";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// Load .env so the harness sees the same COOK_* values the server would. dotenv
// does NOT override vars already present in the real environment.
dotenv.config({ path: path.join(ROOT, ".env") });

const PORT = Number(process.env.COOK_PORT ?? 13100);
const BASE = `http://127.0.0.1:${PORT}`;
const C = (s, c) => `\x1b[${c}m${s}\x1b[0m`;
const bold = (s) => C(s, "1");
const dim = (s) => C(s, "2");
const grn = (s) => C(s, "32");
const yel = (s) => C(s, "33");
const cyn = (s) => C(s, "36");

const totpSecret = process.env.COOK_ADMIN_TOTP_SECRET ?? "";
const authUsers = process.env.COOK_AUTH_USERS ?? "";
const keepData = process.env.COOK_LOCAL_KEEP_DATA === "true";
const gamesDirOverride = process.env.COOK_LOCAL_GAMES_DIR || null;
const verbose = process.env.COOK_LOCAL_VERBOSE !== "false";

// COOK_LOCAL_DEVICES="64hex=label,64hex" → [{deviceKey,label}]
function parseDevices() {
  const raw = process.env.COOK_LOCAL_DEVICES ?? "";
  const out = [];
  for (const part of raw.split(",")) {
    const entry = part.trim();
    if (!entry) continue;
    const eq = entry.indexOf("=");
    const key = (eq === -1 ? entry : entry.slice(0, eq)).trim().toUpperCase();
    const label = eq === -1 ? `local-${out.length + 1}` : entry.slice(eq + 1).trim();
    if (!/^[0-9A-F]{64}$/.test(key) || key === "0".repeat(64)) {
      console.log(yel(`  ⚠ ignoring malformed deviceKey: ${entry.slice(0, 24)}…`));
      continue;
    }
    out.push({ deviceKey: key, label: label || "local" });
  }
  return out;
}
const devices = parseDevices();

if (!totpSecret && devices.length) {
  console.error(yel("⚠ COOK_LOCAL_DEVICES set but COOK_ADMIN_TOTP_SECRET is empty — cannot approve. Set it in .env."));
}

if (!process.env.CI) {
  console.log(bold(`${grn("▶")} CookingFoil local harness  `) + dim(`:${PORT}  pairing=on` + (authUsers ? `  basic-auth=${authUsers}` : "  basic-auth=off")));
}

const dataDir = keepData ? path.join(ROOT, "local-test/data") : mkdtempSync(path.join(tmpdir(), "cook-local-"));
if (keepData) mkdirSync(dataDir, { recursive: true });
const gamesDir = gamesDirOverride ?? path.join(dataDir, "games");
mkdirSync(gamesDir, { recursive: true });

const env = {
  ...process.env,
  COOK_PORT: String(PORT),
  COOK_DATA_DIR: dataDir,
  COOK_GAMES_DIR: gamesDir,
  COOK_DEVICE_PAIRING: "true", // harness always exercises the pairing lane
  COOK_TITLEDB_AUTO_FETCH: process.env.COOK_TITLEDB_AUTO_FETCH ?? "false",
  COOK_LOCKOUT_TRUST_LOOPBACK: "false",
  DEBUG: verbose ? "oc-cookingfoil*" : "",
};

const server = spawn(process.execPath, ["./src/index.js"], {
  cwd: ROOT,
  env,
  stdio: ["ignore", "pipe", "inherit"],
});
let torn = false;
server.stdout.on("data", (b) => process.stdout.write(dim(b.toString())));

async function waitReady() {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`${BASE}/healthz`);
      if (r.ok) return;
    } catch {
      /* not up */
    }
    if (server.exitCode !== null) throw new Error("server exited during boot");
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`server did not become ready at ${BASE}`);
}

// When basic-auth is on, /admin sits inside that perimeter, so the admin must
// present basic-auth credentials in addition to the TOTP code.
function basicHeader() {
  if (!authUsers) return {};
  return { Authorization: `Basic ${Buffer.from(authUsers.split(",")[0]).toString("base64")}` };
}

async function adminSession() {
  if (!totpSecret) throw new Error("COOK_ADMIN_TOTP_SECRET not set");
  const code = await generate({ secret: totpSecret });
  const r = await fetch(`${BASE}/admin/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...basicHeader() },
    body: JSON.stringify({ code }),
  });
  if (!r.ok) throw new Error(`TOTP verify failed: ${r.status}`);
  return (r.headers.get("set-cookie") || "").split(";")[0];
}

async function approve(cookie, deviceKey, label) {
  const r = await fetch(`${BASE}/admin/api/devices/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie, ...basicHeader() },
    body: JSON.stringify({ deviceKey, label }),
  });
  if (!r.ok) throw new Error(`approve ${deviceKey.slice(0, 12)}… failed: ${r.status}`);
  const s = await fetch(`${BASE}/api/pair/status?deviceKey=${deviceKey}`).then((x) => x.json());
  return s.accessKey ?? null;
}

function rule() {
  console.log(dim("  " + "─".repeat(60)));
}

async function main() {
  await waitReady();
  const code = totpSecret ? await generate({ secret: totpSecret }) : "—";

  console.log();
  rule();
  console.log(bold("  Server ready"));
  console.log(`  ${cyn("shop")}    ${BASE}/shop.tfl`);
  if (totpSecret) console.log(`  ${cyn("admin")}   ${BASE}/admin   (TOTP ${grn(code)})`);
  console.log(`  ${cyn("knock")}   ${BASE}/api/pair/status?deviceKey=<KEY>`);
  rule();

  if (devices.length) {
    const cookie = await adminSession();
    console.log();
    console.log(bold("  Pre-approved devices"));
    rule();
    for (const d of devices) {
      const accessKey = await approve(cookie, d.deviceKey, d.label);
      console.log(`  ${cyn(d.label)}`);
      console.log(`    deviceKey  ${dim(d.deviceKey)}`);
      if (accessKey) console.log(`    accessKey  ${grn(accessKey)}  ${yel("(one-time)")}`);
      else console.log(yel("    accessKey  (already consumed — re-run to re-mint)"));
    }
    rule();
  }

  console.log();
  console.log(bold("  Quick curl"));
  if (authUsers) {
    const [first] = authUsers.split(",")[0].split(":");
    console.log(dim(`  # basic-auth lane (id/password) — NRO's User/Pass fields target this`));
    console.log(`  curl -u ${first}:<PASS> ${BASE}/shop.tfl`);
  }
  if (devices.length) {
    const dk = devices[0].deviceKey;
    console.log(dim(`  # knock (auto-registers as pending)`));
    console.log(`  curl "${BASE}/api/pair/status?deviceKey=${dk}"`);
    console.log(dim(`  # pull shop with the printed accessKey`));
    console.log(`  curl ${BASE}/shop.tfl -H "X-Device-Key: ${dk}" -H "X-Access-Key: <KEY>"`);
  }
  console.log();
  console.log(dim(`  Ctrl+C to stop. ${keepData ? "(data kept at local-test/data)" : "(temp data dir removed on exit)"}`));
  console.log();
}

main().catch((e) => {
  console.error(`\x1b[31m✗ ${e.message}\x1b[0m`);
  cleanup(1);
});

function cleanup(code) {
  if (torn) return;
  torn = true;
  if (!server.killed) server.kill("SIGTERM");
  setTimeout(() => {
    if (!server.killed) server.kill("SIGKILL");
    if (!keepData) {
      try {
        rmSync(dataDir, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    }
    process.exit(code ?? 0);
  }, 400);
}

process.on("SIGINT", () => cleanup(0));
process.on("SIGTERM", () => cleanup(0));
server.on("exit", (code) => {
  if (!torn) console.error(dim(`server exited (${code})`));
  cleanup(code ?? 0);
});
