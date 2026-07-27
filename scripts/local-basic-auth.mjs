#!/usr/bin/env node
/**
 * Local basic-auth (id/password) harness — boots a server with ONLY the
 * basic-auth lane on, pairing OFF, no TOTP, no device approval. For testing
 * the NRO's simple User/Pass login path (or curl -u) in isolation.
 *
 *   npm run test:basic
 *   node scripts/local-basic-auth.mjs
 *
 * Reads COOK_PORT / COOK_AUTH_USERS from .env (same as the server). If
 * COOK_AUTH_USERS is unset, a throwaway "demo:secret" pair is used so the
 * feature works out of the box.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
dotenv.config({ path: path.join(ROOT, ".env") });

const PORT = Number(process.env.COOK_PORT ?? 13110);
const BASE = `http://127.0.0.1:${PORT}`;
const C = (s, c) => `\x1b[${c}m${s}\x1b[0m`;
const bold = (s) => C(s, "1");
const dim = (s) => C(s, "2");
const grn = (s) => C(s, "32");
const cyn = (s) => C(s, "36");

const authUsers = process.env.COOK_AUTH_USERS || "demo:secret";
const gamesDirOverride = process.env.COOK_LOCAL_GAMES_DIR || null;
const verbose = process.env.COOK_LOCAL_VERBOSE !== "false";

console.log(bold(`${grn("▶")} CookingFoil basic-auth harness  `) + dim(`:${PORT}  pairing=off  basic-auth=${authUsers}`));

const dataDir = mkdtempSync(path.join(tmpdir(), "cook-basic-"));
const gamesDir = gamesDirOverride ?? path.join(dataDir, "games");
mkdirSync(gamesDir, { recursive: true });

const env = {
  ...process.env,
  COOK_PORT: String(PORT),
  COOK_DATA_DIR: dataDir,
  COOK_GAMES_DIR: gamesDir,
  COOK_AUTH_USERS: authUsers,
  COOK_DEVICE_PAIRING: "false", // pairing OFF — this harness is id/password only
  COOK_TITLEDB_AUTO_FETCH: "false",
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

function rule() {
  console.log(dim("  " + "─".repeat(60)));
}

const [firstUser, ...restP] = authUsers.split(",")[0].split(":");
const firstPass = restP.join(":");

async function main() {
  await waitReady();
  console.log();
  rule();
  console.log(bold("  Server ready  (id/password only)"));
  console.log(`  ${cyn("shop")}    ${BASE}/shop.tfl`);
  console.log(`  ${cyn("login")}   user ${grn(firstUser)}  pass ${grn(firstPass)}`);
  rule();
  console.log();
  console.log(bold("  Quick curl"));
  console.log(dim(`  # good credentials → 200`));
  console.log(`  curl -u ${firstUser}:${firstPass} ${BASE}/shop.tfl`);
  console.log(dim(`  # wrong password → 401`));
  console.log(`  curl -u ${firstUser}:wrong ${BASE}/shop.tfl`);
  console.log(dim(`  # no credentials → 401`));
  console.log(`  curl ${BASE}/shop.tfl`);
  console.log();
  console.log(dim("  Override COOK_AUTH_USERS in .env to use your own pair. Ctrl+C to stop."));
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
    try {
      rmSync(dataDir, { recursive: true, force: true });
    } catch {
      /* best effort */
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
