import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// name-health.test.js already covers the pure verdictFor()/buildNameHealth()
// matrix. This file exercises the I/O-facing wiring around them —
// readTitledb(), readExtraction(), getNameHealth(), extractionSummary() and
// logNameHealth() — which are 0% covered because they're only reachable via
// the two exported async functions and depend on env-driven module state
// (COOK_EXTRACT_ICONS, COOK_NSTOOL_BIN, COOK_PROD_KEYS_PATH, COOK_DATA_DIR).
//
// Each case runs in its own child process (env vars like COOK_EXTRACT_ICONS
// are read once at module load — see helpers/envs.js) with cwd pinned to
// this directory so dotenv's `./.env` lookup can't pick up the real project
// .env and leak unrelated nstool/keys paths into the probe.

function freshDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), "name-health-test-"));
}

function writeTitledbFixture(dataDir, file, json) {
  const dir = path.join(dataDir, "titledb");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, file), JSON.stringify(json));
}

function runProbe(script, env) {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: import.meta.dirname,
    env: { ...process.env, ...env },
    encoding: "utf-8",
  });
  if (result.status !== 0) {
    throw new Error(
      `probe exited ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
    );
  }
  return { stdout: result.stdout, stderr: result.stderr };
}

const GET_HEALTH_SCRIPT = `
  import { getNameHealth } from "../../src/meta/name-health.js";
  const nh = await getNameHealth();
  process.stdout.write(JSON.stringify(nh));
`;

const GET_HEALTH_WITH_TITLEDB_SCRIPT = `
  import * as titledbStore from "../../src/meta/titledb-store.js";
  import { getNameHealth } from "../../src/meta/name-health.js";
  await titledbStore.load();
  const nh = await getNameHealth();
  process.stdout.write(JSON.stringify(nh));
`;

const LOG_HEALTH_SCRIPT = `
  import { logNameHealth } from "../../src/meta/name-health.js";
  const nh = await logNameHealth();
  process.stdout.write(JSON.stringify(nh));
`;

// Baseline env with tooling forced absent/present deterministically —
// explicit paths always win over PATH lookup in nsp.js's resolveBinary().
function baseEnv(overrides) {
  const dataDir = freshDataDir();
  return {
    dataDir,
    env: {
      COOK_DATA_DIR: dataDir,
      COOK_NSTOOL_BIN: "/nonexistent/nstool",
      COOK_PROD_KEYS_PATH: path.join(dataDir, "no-such-prod.keys"),
      DEBUG: "",
      ...overrides,
    },
  };
}

// ── getNameHealth(): readTitledb() + readExtraction() wiring ──────────────

test("getNameHealth: empty titledb + no tooling + default mode → degraded, nroCapable true", () => {
  const { env } = baseEnv({});
  const { stdout } = runProbe(GET_HEALTH_SCRIPT, env);
  const nh = JSON.parse(stdout);

  assert.equal(nh.titledb.titles, 0);
  assert.deepEqual(nh.titledb.regions, []);
  assert.equal(nh.extraction.mode, "missing"); // COOK_EXTRACT_ICONS unset → default
  assert.equal(nh.extraction.nstool, false);
  assert.equal(nh.extraction.prodKeys, false);
  assert.equal(nh.extraction.nspXciCapable, false);
  assert.equal(nh.extraction.nroCapable, true);
  assert.equal(nh.extraction.maxGb, 4); // COOK_EXTRACT_MAX_GB unset → default
  assert.equal(nh.verdict, "degraded");
});

test("getNameHealth: extraction fully off + empty titledb → filename-only", () => {
  const { env } = baseEnv({ COOK_EXTRACT_ICONS: "off" });
  const { stdout } = runProbe(GET_HEALTH_SCRIPT, env);
  const nh = JSON.parse(stdout);

  assert.equal(nh.extraction.mode, "off");
  assert.equal(nh.extraction.nroCapable, false);
  assert.equal(nh.extraction.nspXciCapable, false);
  assert.equal(nh.verdict, "filename-only");
});

test("getNameHealth: nstool + prod.keys both resolve, mode all → ok, nspXciCapable true", () => {
  const { dataDir, env } = baseEnv({ COOK_EXTRACT_ICONS: "all" });
  const keysPath = path.join(dataDir, "prod.keys");
  writeFileSync(keysPath, "fake-key-material");
  const { stdout } = runProbe(GET_HEALTH_SCRIPT, {
    ...env,
    COOK_NSTOOL_BIN: process.execPath, // any real, executable file works — status() only probes access
    COOK_PROD_KEYS_PATH: keysPath,
  });
  const nh = JSON.parse(stdout);

  assert.equal(nh.extraction.nstool, true);
  assert.equal(nh.extraction.prodKeys, true);
  assert.equal(nh.extraction.nspXciCapable, true);
  assert.equal(nh.extraction.nroCapable, true);
  assert.equal(nh.verdict, "ok");
});

test("getNameHealth: populated titledb → ok even with extraction fully off", () => {
  const { dataDir, env } = baseEnv({ COOK_EXTRACT_ICONS: "off" });
  writeTitledbFixture(dataDir, "US.en.json", {
    a: { id: "0100000000010000", name: "Some Game" },
  });
  const { stdout } = runProbe(GET_HEALTH_WITH_TITLEDB_SCRIPT, env);
  const nh = JSON.parse(stdout);

  assert.equal(nh.titledb.titles, 1);
  assert.deepEqual(nh.titledb.regions, ["US.en"]);
  assert.equal(nh.extraction.mode, "off");
  assert.equal(nh.verdict, "ok"); // titledbTitles > 0 wins regardless of extraction
});

// ── logNameHealth(): extractionSummary() branches + error-vs-info level ───

test("logNameHealth: filename-only verdict logs the operator hint at error level", () => {
  const { env } = baseEnv({
    COOK_EXTRACT_ICONS: "off",
    DEBUG: "oc-cookingfoil,oc-cookingfoil:err",
  });
  const { stdout, stderr } = runProbe(LOG_HEALTH_SCRIPT, env);
  const nh = JSON.parse(stdout);

  assert.equal(nh.verdict, "filename-only");
  assert.match(stderr, /\[name-health]/);
  assert.match(stderr, /titledb=0 titles/);
  assert.match(stderr, /NSP extraction=disabled: extraction off/);
  assert.match(stderr, /verdict=filename-only/);
  assert.match(stderr, /names WILL fall back to filenames/);
});

test("logNameHealth: ok verdict (tooling ready) logs at info level, no filename-only hint", () => {
  const { dataDir, env } = baseEnv({
    COOK_EXTRACT_ICONS: "all",
    DEBUG: "oc-cookingfoil,oc-cookingfoil:err",
  });
  const keysPath = path.join(dataDir, "prod.keys");
  writeFileSync(keysPath, "fake-key-material");
  const { stdout, stderr } = runProbe(LOG_HEALTH_SCRIPT, {
    ...env,
    COOK_NSTOOL_BIN: process.execPath,
    COOK_PROD_KEYS_PATH: keysPath,
  });
  const nh = JSON.parse(stdout);

  assert.equal(nh.verdict, "ok");
  assert.match(stderr, /NSP extraction=enabled/);
  assert.match(stderr, /verdict=ok/);
  assert.doesNotMatch(stderr, /names WILL fall back/);
});

test("logNameHealth: degraded verdict (no nstool) reports 'disabled: no nstool' at info level", () => {
  const { env } = baseEnv({
    COOK_EXTRACT_ICONS: "all",
    DEBUG: "oc-cookingfoil,oc-cookingfoil:err",
  });
  const { stdout, stderr } = runProbe(LOG_HEALTH_SCRIPT, env);
  const nh = JSON.parse(stdout);

  assert.equal(nh.verdict, "degraded");
  assert.match(stderr, /NSP extraction=disabled: no nstool/);
  assert.doesNotMatch(stderr, /names WILL fall back/);
});

test("logNameHealth: nstool present but prod.keys missing reports 'disabled: no prod.keys'", () => {
  const { env } = baseEnv({
    COOK_EXTRACT_ICONS: "all",
    DEBUG: "oc-cookingfoil,oc-cookingfoil:err",
  });
  const { stdout, stderr } = runProbe(LOG_HEALTH_SCRIPT, {
    ...env,
    COOK_NSTOOL_BIN: process.execPath, // resolves fine
    // COOK_PROD_KEYS_PATH stays the nonexistent default from baseEnv()
  });
  const nh = JSON.parse(stdout);

  assert.equal(nh.verdict, "degraded");
  assert.match(stderr, /NSP extraction=disabled: no prod\.keys/);
});
