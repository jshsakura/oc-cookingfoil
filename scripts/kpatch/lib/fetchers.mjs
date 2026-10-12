/**
 * Fetching a package from the places that don't need a person: pixeldrain,
 * the latest GitHub release, and Google Drive. Each returns what the plan
 * needs to decide (the file name, the version) before anything is downloaded,
 * and a `get(dir)` that downloads it.
 */
import path from "node:path";
import { download, getJson, getText } from "./net.mjs";
import { pickGithubAsset } from "./sources.mjs";

async function pixeldrain(src) {
  const { json } = await getJson(`https://pixeldrain.com/api/file/${src.id}/info`);
  if (!json?.name) return { ok: false, reason: "pixeldrain 파일이 지워졌습니다" };
  return {
    ok: true,
    name: json.name,
    uploaded: json.date_upload ?? "",
    size: json.size ?? 0,
    version: null,
    sourceUrl: src.url,
    get: (dir) => download(`https://pixeldrain.com/api/file/${src.id}?download`, path.join(dir, json.name)),
  };
}

async function github(src, tid) {
  const { status, json } = await getJson(`https://api.github.com/repos/${src.repo}/releases/latest`);
  if (status !== 200 || !json) return { ok: false, reason: `GitHub 릴리스가 없습니다 (${status})` };
  const asset = pickGithubAsset(json.assets ?? [], tid);
  if (!asset) return { ok: false, kind: "xdelta", reason: `스위치용 zip 이 없습니다 (${json.tag_name}: ${(json.assets ?? []).map((a) => a.name).join(", ")})` };
  return {
    ok: true,
    name: asset.name,
    version: String(json.tag_name).replace(/^v/i, ""),
    sourceUrl: json.html_url,
    get: (dir) => download(asset.browser_download_url, path.join(dir, asset.name)),
  };
}

async function gdrive(src) {
  const { text } = await getText(`https://drive.google.com/file/d/${src.id}/view`);
  const name = text.match(/<title>(.*?) - Google Drive<\/title>/)?.[1];
  if (!name) return { ok: false, reason: "구글 드라이브 파일이 지워졌거나 비공개입니다" };
  return {
    ok: true,
    name,
    version: null,
    sourceUrl: src.url,
    get: (dir) => download(`https://drive.usercontent.google.com/download?id=${src.id}&export=download&confirm=t`, path.join(dir, path.basename(name))),
  };
}

const FETCHERS = { pixeldrain, github, gdrive };
export const FETCHABLE = Object.keys(FETCHERS);

/**
 * Of several pixeldrain uploads in one post (a post often keeps every
 * version's link), the newest upload; the larger file breaks a tie, since a
 * same-day small file is an add-on, not the patch. Pure.
 */
export function newestUpload(found) {
  return found.reduce((best, f) => {
    if (!best) return f;
    if (f.uploaded !== best.uploaded) return f.uploaded > best.uploaded ? f : best;
    return f.size > best.size ? f : best;
  }, null);
}

/** The source to fetch for a post, probed: pixeldrain (newest upload), then GitHub, then Drive. */
export async function probe(sources = [], tid) {
  const tried = [];
  const pd = [];
  for (const src of sources.filter((s) => s.type === "pixeldrain")) {
    const r = await pixeldrain(src);
    if (r.ok) pd.push(r);
    else tried.push(`pixeldrain: ${r.reason}`);
  }
  if (pd.length) return { ...newestUpload(pd), type: "pixeldrain" };
  for (const src of sources.filter((s) => FETCHERS[s.type] && s.type !== "pixeldrain")) {
    const r = await FETCHERS[src.type](src, tid);
    if (r.ok) return { ...r, type: src.type };
    tried.push(`${src.type}: ${r.reason}`);
    if (r.kind === "xdelta") return { ok: false, kind: "xdelta", reason: r.reason, type: src.type, sourceUrl: src.url };
  }
  return { ok: false, reason: tried.join(" / ") || "자동으로 받을 수 있는 배포처가 없습니다" };
}
