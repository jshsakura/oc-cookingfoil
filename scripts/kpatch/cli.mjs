#!/usr/bin/env node
/**
 * kpatch: keep CookingFoil's Korean patches current from a list of patch posts.
 *
 *   node scripts/kpatch/cli.mjs collect <list.json>   read every post and the pages it links to
 *   node scripts/kpatch/cli.mjs plan                  settle title ids, pick the newest post per game
 *   node scripts/kpatch/cli.mjs apply [--force]       install/replace the LayeredFS patches in the plan
 *   node scripts/kpatch/cli.mjs report                write report.md for the last run
 *   node scripts/kpatch/cli.mjs wanted                patched games with no ROM, checked against oc-scraper
 *   node scripts/kpatch/cli.mjs adopt <tid…>          let kpatch manage patches already in the folder
 *
 * Every step reads and writes files under $KPATCH_HOME/runs/<run>/, so each
 * can be re-run alone and a person (or GLM) can read what it decided.
 *
 * Posts left in "review" are settled in $KPATCH_HOME/overrides.json
 * ({ "<cafe>/<article>": { tid, why } | { ignore: true, why } }), and only on
 * evidence: the id written on the post or a page it links to, the package's
 * own folder or file name, a game with a single edition in titledb, or another
 * post for the same game settled that way. A wrong id loads the patch into
 * another game, so guesses stay in review.
 */
import fs from "node:fs";
import path from "node:path";
import { collect } from "./steps/collect.mjs";
import { plan } from "./steps/plan.mjs";
import { apply } from "./steps/apply.mjs";
import { report } from "./steps/report.mjs";
import { wanted } from "./steps/wanted.mjs";
import { adopt } from "./steps/adopt.mjs";

const HOME = process.env.KPATCH_HOME || path.join(process.env.HOME, "app/kpatch");

// Secrets (the oc-scraper token) live in $KPATCH_HOME/.env, outside the repo.
const ENV_FILE = path.join(HOME, ".env");
if (fs.existsSync(ENV_FILE)) {
  for (const line of fs.readFileSync(ENV_FILE, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
  }
}
export const CONFIG = {
  home: HOME,
  titledb: process.env.KPATCH_TITLEDB || "/mnt/SSD-1TB-DOCKER/appdata/tinfoil-hat/data/titledb",
  patches: process.env.KPATCH_PATCHES || "/mnt/HDD-8TB-STRIPE/media3/game/switch/patches",
  roms: process.env.KPATCH_ROMS || "/mnt/HDD-8TB-STRIPE/media3/game/switch/roms",
  scraper: (process.env.KPATCH_SCRAPER_URL || "http://100.109.62.68:18765").replace(/\/$/, ""),
  scraperToken: process.env.KPATCH_SCRAPER_TOKEN || "",
};

function runDir(fresh) {
  const runs = path.join(HOME, "runs");
  fs.mkdirSync(runs, { recursive: true });
  if (fresh) {
    const dir = path.join(runs, new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19));
    fs.mkdirSync(dir, { recursive: true });
    fs.rmSync(path.join(runs, "latest"), { force: true });
    fs.symlinkSync(path.basename(dir), path.join(runs, "latest"));
    return dir;
  }
  const latest = path.join(runs, "latest");
  if (!fs.existsSync(latest)) throw new Error("먼저 collect 를 실행해야 합니다");
  return fs.realpathSync(latest);
}

const [cmd, ...args] = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const positional = args.filter((a) => !a.startsWith("--"));

const STEPS = {
  collect: () => collect(positional[0], runDir(true), CONFIG),
  plan: () => plan(runDir(false), CONFIG),
  apply: () => apply(runDir(false), CONFIG, { force: flags.has("--force"), dryRun: flags.has("--dry-run") }),
  report: () => report(runDir(false), CONFIG),
  wanted: () => wanted(runDir(false), CONFIG, { push: flags.has("--push") }),
  adopt: () => adopt(runDir(false), CONFIG, positional),
};

if (!STEPS[cmd]) {
  console.error("사용법: cli.mjs collect <list.json> | plan | apply [--force] [--dry-run] | report | wanted [--push] | adopt <tid…>");
  process.exit(2);
}
try {
  await STEPS[cmd]();
} catch (err) {
  console.error(`[kpatch ${cmd}] ${err.message}`);
  process.exit(1);
}
