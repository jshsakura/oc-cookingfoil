/**
 * Reading patch posts. Naver cafe bodies come from the article API without a
 * login (attachments still need one); members-only boards answer 401. Pages a
 * post links to (GitHub, dcinside, tistory) are read once for title ids.
 */
import { getJson, getText } from "./net.mjs";
import { baseIdsIn } from "./ids.mjs";
import { sourcesIn } from "./sources.mjs";

/** "hansicgu/34047" from a cafe article link, or null. Pure. */
export function articleKey(url) {
  const m = String(url ?? "").match(/cafe\.naver\.com\/(\w+)\/(\d+)/);
  return m ? `${m[1]}/${m[2]}` : null;
}

const textOf = (html) => html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/g, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#\d+;|\s+/g, " ").trim();

/** The patch version a post states ("패치버전 : 0.9.1", or a vX.Y in its subject). Pure. */
export function versionIn(subject, text) {
  const stated = String(text ?? "").match(/패치\s*버전\s*[:：]\s*v?([0-9][\w.-]*)/i)?.[1];
  return stated ?? String(subject ?? "").match(/\bv?(\d+\.\d+(?:\.\d+)*)/i)?.[1] ?? null;
}

export async function readArticle(key) {
  const [cafe, id] = key.split("/");
  const { status, json } = await getJson(`https://apis.naver.com/cafe-web/cafe-articleapi/v2.1/cafes/${cafe}/articles/${id}?useCafeId=false`);
  const art = json?.result?.article;
  if (status !== 200 || !art) return { key, status, readable: false };
  const html = art.contentHtml ?? "";
  const text = textOf(html);
  return {
    key,
    status,
    readable: true,
    subject: art.subject,
    date: art.writeDate ? new Date(art.writeDate).toISOString().slice(0, 10) : null,
    version: versionIn(art.subject, text),
    ids: baseIdsIn(html),
    sources: sourcesIn(html),
    attachments: (json.result.attaches ?? []).map((a) => a.name ?? a.fileName).filter(Boolean),
  };
}

const READ_FOR_IDS = new Set(["github", "dcinside", "tistory"]);

/** Title ids written on the pages a post links to. */
export async function idsOnLinkedPages(sources) {
  const ids = [];
  for (const s of sources.filter((x) => READ_FOR_IDS.has(x.type))) {
    const { text } = await getText(s.url);
    for (const t of baseIdsIn(text)) if (!ids.includes(t)) ids.push(t);
  }
  return ids;
}
