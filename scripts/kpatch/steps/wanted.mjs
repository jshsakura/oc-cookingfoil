/**
 * Step 5: games that have a Korean patch here but no ROM in the library.
 * With --push they go to oc-scraper's request API (groms, on a1-ubuntu), whose
 * answer says per title whether it already has links. Output: wanted.json,
 * wanted-push.json.
 *
 * The patch decides the region: a patch for the Japanese edition needs the
 * Japanese ROM, so the lookup is by the exact title id, never by name.
 */
import fs from "node:fs";
import path from "node:path";
import { loadTitleIndex, titleName } from "../lib/titledb.mjs";
import { ownedTitleIds } from "../lib/library.mjs";
import { PATCH_NAME } from "../lib/install.mjs";

const TID_DIR = /^0100[0-9A-F]{12}$/;

/** Hand the list to oc-scraper's request API (POST /api/wanted), so nas_fetch fetches them first. */
async function push(config, list) {
  if (!config.scraperToken) throw new Error("KPATCH_SCRAPER_TOKEN 이 없어 요청을 보낼 수 없습니다");
  const items = list.map((w) => ({ title_id: w.title_id, name: w.name, reason: `한글패치 ${w.patch === "installed" ? "설치됨" : "대기"}, 이 판의 롬이 필요합니다` }));
  const res = await fetch(`${config.scraper}/api/wanted`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Wanted-Token": config.scraperToken },
    body: JSON.stringify({ source: "kpatch", items }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`oc-scraper 요청 API 가 ${res.status} 로 거절했습니다`);
  return res.json();
}

export async function wanted(dir, config, { push: shouldPush = false } = {}) {
  const index = loadTitleIndex(config.titledb);
  const owned = ownedTitleIds(config.roms);
  const patched = fs.readdirSync(config.patches).filter((t) => TID_DIR.test(t) && fs.existsSync(path.join(config.patches, t, PATCH_NAME)));
  const plan = fs.existsSync(path.join(dir, "plan.json")) ? JSON.parse(fs.readFileSync(path.join(dir, "plan.json"), "utf8")) : [];
  const fromPlan = plan.filter((i) => i.tid && ["manual", "xdelta-pending", "exists-manual"].includes(i.action)).map((i) => i.tid);

  const out = [];
  for (const tid of [...new Set([...patched, ...fromPlan])].sort()) {
    if (owned.has(tid)) continue;
    out.push({ title_id: tid, name: titleName(index, tid), patch: patched.includes(tid) ? "installed" : "pending" });
  }
  fs.writeFileSync(path.join(dir, "wanted.json"), `${JSON.stringify(out, null, 1)}\n`);
  console.log(`한글패치는 있는데 롬이 없는 게임 ${out.length}개 → ${path.join(dir, "wanted.json")}`);
  if (shouldPush && out.length) {
    const r = await push(config, out);
    fs.writeFileSync(path.join(dir, "wanted-push.json"), `${JSON.stringify(r, null, 1)}\n`);
    const links = (r.accepted ?? []).filter((a) => a.has_links).length;
    console.log(`oc-scraper 에 요청 ${r.accepted?.length ?? 0}건 등록 (링크 있음 ${links}), 거절 ${r.rejected?.length ?? 0}건`);
  }
}
