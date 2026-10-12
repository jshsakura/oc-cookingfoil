/**
 * Step 2: settle each post's title id, probe its download, keep the newest
 * post per game and decide what to do. Nothing is downloaded or installed.
 * Output: plan.json.
 *
 * Actions: install · replace · skip · exists-manual (a person's patch is there)
 * · xdelta-pending (needs the game's files) · manual (no fetchable source)
 * · review (title id not settled, or the post can't be read)
 * · ignored (overrides.json says the post is not a Switch patch).
 */
import fs from "node:fs";
import path from "node:path";
import { loadTitleIndex, titleName } from "../lib/titledb.mjs";
import { resolveTitleId } from "../lib/resolve.mjs";
import { probe } from "../lib/fetchers.mjs";
import { baseIdsIn } from "../lib/ids.mjs";
import { decide, latestPerTitle } from "../lib/plan.mjs";
import { loadState } from "../lib/state.mjs";
import { PATCH_NAME } from "../lib/install.mjs";

function overrides(home) {
  const file = path.join(home, "overrides.json");
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
}

async function settle(rec, index, pinned) {
  if (pinned) return { tid: pinned.tid, by: `override: ${pinned.why}` };
  const ids = [...(rec.ids ?? []), ...(rec.linkedIds ?? []).filter((t) => !(rec.ids ?? []).includes(t))];
  const first = resolveTitleId({ ids }, index);
  if (first.tid || first.candidates?.length) return first;
  // Uploads are often named after the game (pixeldrain <tid>.zip): probe to read the name.
  const p = await probe(rec.sources ?? [], null);
  return { ...resolveTitleId({ ids: [], fileIds: p.ok ? baseIdsIn(p.name) : [] }, index), probed: p };
}

export async function plan(dir, config) {
  const records = JSON.parse(fs.readFileSync(path.join(dir, "records.json"), "utf8"));
  const index = loadTitleIndex(config.titledb);
  const pins = overrides(config.home);
  const items = [];

  for (const rec of records) {
    const base = { key: rec.key, articleUrl: rec.articleUrl ?? null, subject: rec.subject ?? rec.listTitle, date: rec.date, sources: rec.sources ?? [] };
    if (pins[rec.key]?.ignore) {
      items.push({ ...base, tid: null, action: "ignored", reason: pins[rec.key].why });
      continue;
    }
    if (!rec.readable && !pins[rec.key]) {
      items.push({ ...base, tid: null, action: "review", reason: `본문을 읽지 못했습니다 (${rec.status}). 회원 전용이거나 지워진 글입니다` });
      continue;
    }
    const r = await settle(rec, index, pins[rec.key]);
    if (!r.tid) {
      items.push({ ...base, tid: null, action: "review", reason: r.reason, candidates: (r.candidates ?? []).map((t) => `${t} ${titleName(index, t)}`) });
      continue;
    }
    items.push({ ...base, tid: r.tid, name: titleName(index, r.tid), by: r.by, version: rec.version, rec });
  }

  const state = loadState(config.home);
  const out = [];
  for (const it of latestPerTitle(items)) {
    if (!it.tid) { out.push(it); continue; }
    const { rec, ...item } = it;
    const p = await probe(rec.sources ?? [], it.tid);
    if (!p.ok) {
      const action = p.kind === "xdelta" ? "xdelta-pending" : "manual";
      out.push({ ...item, action, reason: p.reason, sourceUrl: p.sourceUrl ?? null });
      continue;
    }
    const version = p.version ?? item.version ?? null;
    const exists = fs.existsSync(path.join(config.patches, it.tid, PATCH_NAME));
    const tracked = state.installed[it.tid] ?? null;
    const action = decide({ version, sourceUrl: p.sourceUrl }, { exists, tracked });
    out.push({ ...item, version, source: { type: p.type, name: p.name }, sourceUrl: p.sourceUrl, action, installedVersion: tracked?.version ?? null });
  }

  fs.writeFileSync(path.join(dir, "plan.json"), `${JSON.stringify(out, null, 1)}\n`);
  const count = out.reduce((m, i) => ({ ...m, [i.action]: (m[i.action] ?? 0) + 1 }), {});
  console.log(Object.entries(count).map(([k, v]) => `${k} ${v}`).join(" · "));
}
