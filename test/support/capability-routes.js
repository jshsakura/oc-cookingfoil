// Every route the server answers, and the check that each one has a capability or an opt-out.
// Used by test/unit/capability-coverage.test.js.
//
// Routes are read from the running app, not from source text: src/index.js is started in a child
// process with test/support/capability-listen-hook.js preloaded, which walks the real Express
// router when the app calls listen() and exits before a port opens. However a route is registered,
// it is seen, as long as it is registered unconditionally (see AGENTS.md).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { routeKey } from "../../src/capabilities/define.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const HOOK = new URL("./capability-listen-hook.js", import.meta.url).href;
const INDEX = new URL("../../src/index.js", import.meta.url);

/**
 * Every route of the app as "METHOD /path", sorted. Starts `entry` (src/index.js by default) with a
 * scratch data dir and every route-gating feature on. Throws with the child's error if the walk fails.
 */
export function discoverRoutes({ entry = INDEX } = {}) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "cook-capability-routes-"));
  try {
    fs.mkdirSync(path.join(data, "games"));
    const run = spawnSync(process.execPath, ["--import", HOOK, fileURLToPath(entry)], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 60_000,
      maxBuffer: 16 * 1024 * 1024,
      env: {
        ...process.env,
        COOK_DATA_DIR: data,
        COOK_GAMES_DIR: path.join(data, "games"),
        // Routes that only exist when a feature is on must be seen too.
        COOK_UPLOADS_ENABLED: "true",
        COOK_ADMIN_TOKEN: "x",
        COOK_TITLEDB_AUTO_FETCH: "false",
        COOK_HOMEBREW_REPOS: "",
        COOK_RETRO_META: "false",
      },
    });
    if (run.status !== 0) {
      const why = run.error?.message ?? (run.stderr.trim().split("\n").slice(-5).join("\n") || `exit ${run.status ?? run.signal}`);
      throw new Error(`route discovery failed for ${fileURLToPath(entry)}: ${why}`);
    }
    return [...new Set(JSON.parse(run.stdout).map(([method, p]) => routeKey({ method, path: p })))].sort();
  } finally {
    fs.rmSync(data, { recursive: true, force: true });
  }
}

/**
 * Problems with route coverage: routes nobody accounts for, entries that name no route, routes listed
 * twice, and opt-outs without an allowed reason. Empty when everything lines up.
 */
export function coverageProblems({ routes, capabilities, optOut, legacy, reasons }) {
  const problems = [];
  const claimed = new Map();
  const claim = (key, by) => {
    if (claimed.has(key)) problems.push(`Route ${key} is listed twice: ${claimed.get(key)} and ${by}. Keep one.`);
    else claimed.set(key, by);
  };
  for (const cap of capabilities) if (cap.http) claim(routeKey(cap.http), `capability ${cap.id}`);
  for (const [key, reason] of Object.entries(optOut)) {
    if (!(reason in reasons) || reason === "legacy-unregistered") {
      problems.push(`Route ${key} in OPT_OUT has reason "${reason}". Use one of: ${Object.keys(reasons).filter((r) => r !== "legacy-unregistered").join(", ")}.`);
    }
    claim(key, "OPT_OUT");
  }
  for (const key of legacy) claim(key, "LEGACY_UNREGISTERED");

  const known = new Set(routes);
  for (const [key, by] of claimed) {
    if (!known.has(key)) problems.push(`${by} names ${key}, but the server has no such route. Remove it or fix the method and path.`);
  }
  for (const key of routes) {
    if (claimed.has(key)) continue;
    problems.push(
      `Route ${key} has no capability. Add one in src/capabilities/<area>.js with defineCapability() ` +
        `(see src/capabilities/define.js) and list it in src/capabilities/registry.js, or add it to OPT_OUT in ` +
        `src/capabilities/opt-out.js with a reason (browser-only, token-blocked, binary-upload).`,
    );
  }
  return problems;
}

/** A count that may only go down, and whose ceiling follows it down. */
export function ratchetProblems({ name, count, ceiling, where }) {
  if (count > ceiling) return [`${name} grew from ${ceiling} to ${count}. It only shrinks: register the route as a capability instead.`];
  if (count < ceiling) return [`${name} shrank to ${count}. Lower its ceiling in ${where} from ${ceiling} to ${count} so it cannot grow back.`];
  return [];
}
