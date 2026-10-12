/**
 * Step 1: read every post on the list. Posts are deduplicated by article; a
 * list entry that points straight at a file (pixeldrain) becomes its own
 * record. Output: records.json.
 */
import fs from "node:fs";
import path from "node:path";
import { articleKey, idsOnLinkedPages, readArticle } from "../lib/pages.mjs";
import { sourcesIn } from "../lib/sources.mjs";
import { FETCHABLE } from "../lib/fetchers.mjs";

const PAUSE_MS = 400;
const pause = () => new Promise((r) => setTimeout(r, PAUSE_MS));

export async function collect(listPath, dir) {
  if (!listPath || !fs.existsSync(listPath)) throw new Error(`목록 파일이 없습니다: ${listPath}`);
  const list = JSON.parse(fs.readFileSync(listPath, "utf8"));
  const records = [];
  const seen = new Set();

  for (const entry of list) {
    const direct = sourcesIn(entry.download_url ?? "").filter((s) => FETCHABLE.includes(s.type));
    const key = articleKey(entry.download_url) ?? articleKey(entry.post_url);
    const id = direct.length ? direct[0].url : key;
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const base = { listTitle: entry.title, listVersion: entry.version ?? null, kpStarUrl: entry.kp_star_url ?? null };
    if (direct.length) {
      records.push({ ...base, key: id, readable: true, subject: entry.title, date: entry.posted_at ?? null, version: null, ids: [], linkedIds: [], sources: direct });
      continue;
    }
    const art = await readArticle(key);
    const linkedIds = art.readable ? await idsOnLinkedPages(art.sources) : [];
    records.push({ ...base, ...art, articleUrl: `https://cafe.naver.com/${key}`, linkedIds });
    console.log(`${art.readable ? "읽음" : `못읽음(${art.status})`}  ${key}  ${art.subject ?? entry.title}`);
    await pause();
  }

  fs.writeFileSync(path.join(dir, "records.json"), `${JSON.stringify(records, null, 1)}\n`);
  console.log(`글 ${records.length}건 → ${path.join(dir, "records.json")}`);
}
