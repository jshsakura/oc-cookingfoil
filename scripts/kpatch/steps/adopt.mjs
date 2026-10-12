/**
 * Let kpatch manage patches that are already in the folder. Each title id
 * must be in the last plan as "exists-manual": its source and version are
 * recorded as what is installed, so a later release replaces it. Run this only
 * for patches known to come from that same source.
 */
import fs from "node:fs";
import path from "node:path";
import { loadState, saveState } from "../lib/state.mjs";

export async function adopt(dir, config, tids) {
  if (!tids.length) throw new Error("넘겨받을 title id 를 적어야 합니다");
  const plan = JSON.parse(fs.readFileSync(path.join(dir, "plan.json"), "utf8"));
  const state = loadState(config.home);
  for (const raw of tids) {
    const tid = raw.toUpperCase();
    const item = plan.find((i) => i.tid === tid && i.action === "exists-manual");
    if (!item) {
      console.log(`건너뜀  ${tid}  계획에 exists-manual 로 없습니다`);
      continue;
    }
    state.installed[tid] = { version: item.version ?? null, sourceUrl: item.sourceUrl, articleUrl: item.articleUrl, installedAt: null, adopted: new Date().toISOString() };
    console.log(`넘겨받음  ${tid}  ${item.name}  ${item.version ?? ""}`);
  }
  saveState(config.home, state);
}
