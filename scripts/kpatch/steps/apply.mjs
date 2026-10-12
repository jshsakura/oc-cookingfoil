/**
 * Step 3: download and install the plan's install/replace items. A package
 * that turns out not to be LayeredFS is parked in xdelta-pending/<tid>/ for
 * when the game's files are at hand. Output: apply.json, state.json.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { probe } from "../lib/fetchers.mjs";
import { gameVersionNote, installPatch, patchMeta, unpack } from "../lib/install.mjs";
import { loadState, saveState } from "../lib/state.mjs";

async function one(item, config, { force, dryRun }) {
  const p = await probe(item.sources, item.tid);
  if (!p.ok) return { result: "failed", reason: p.reason };
  const cache = path.join(config.home, "cache", item.tid);
  const { file } = await p.get(cache);
  try {
    if (!/\.zip$/i.test(file)) return { result: "manual", reason: `zip 이 아닙니다: ${path.basename(file)}` };
    const files = await unpack(file, path.join(cache, "x"));
    const meta = patchMeta({ version: p.version ?? item.version, sourceUrl: p.sourceUrl, articleUrl: item.articleUrl, note: gameVersionNote(p.name) });
    const r = await installPatch({ files, tid: item.tid, meta, patchesDir: config.patches, replace: item.action === "replace" || force, dryRun });
    if (r.kind !== "layeredfs") {
      const parked = path.join(config.home, "xdelta-pending", item.tid, path.basename(file));
      if (!dryRun) {
        await fsp.mkdir(path.dirname(parked), { recursive: true });
        await fsp.rename(file, parked);
      }
      return { result: "xdelta-pending", reason: `${r.kind} 패키지입니다 → ${parked}` };
    }
    return { result: dryRun ? "would-install" : "installed", files: r.installed, dropped: r.dropped, version: meta.version ?? null, sourceUrl: p.sourceUrl };
  } finally {
    await fsp.rm(cache, { recursive: true, force: true }).catch(() => {});
  }
}

export async function apply(dir, config, opts) {
  const items = JSON.parse(fs.readFileSync(path.join(dir, "plan.json"), "utf8"));
  const state = loadState(config.home);
  const results = [];
  for (const item of items.filter((i) => i.action === "install" || i.action === "replace" || (opts.force && i.action === "exists-manual"))) {
    let r;
    try {
      r = await one(item, config, opts);
    } catch (err) {
      r = { result: "failed", reason: err.message };
    }
    console.log(`${r.result}  ${item.tid}  ${item.name}  ${r.reason ?? `${r.files}개 파일`}`);
    results.push({ tid: item.tid, name: item.name, action: item.action, ...r });
    if (r.result === "installed") {
      state.installed[item.tid] = { version: r.version, sourceUrl: r.sourceUrl, articleUrl: item.articleUrl, installedAt: new Date().toISOString() };
      saveState(config.home, state);
    }
  }
  fs.writeFileSync(path.join(dir, "apply.json"), `${JSON.stringify(results, null, 1)}\n`);
}
