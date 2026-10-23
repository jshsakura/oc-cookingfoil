/**
 * Pictures to pick from for one slot of a game, a homebrew app or a patch, the
 * way Plex offers posters: the eShop's own (every region's icon and banner and
 * the screenshots), SteamGridDB (square grids for the icon, heroes for the
 * banner, box covers for a retro game) and IGDB (cover, artworks, screenshots);
 * a retro game's box art also from libretro-thumbnails (the route passes those in). The admin picks one; the
 * page fetches it through remoteImage() and cuts and uploads it like a file.
 *
 * A candidate: { source: "eshop" | "libretro" | "sgdb" | "igdb", game: { id, name } | null, label, thumb, url }.
 */
import * as igdb from "./igdb-client.js";
import * as titledb from "./titledb-store.js";
import * as integrations from "../security/integrations.js";

const SGDB = "https://www.steamgriddb.com/api/v2";
const IGDB_IMAGES = "https://images.igdb.com/igdb/image/upload/";
const TIMEOUT_MS = 10_000;
const GAMES = 2;
const PER_GAME = 12;
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
// boxart: a retro game's cover (portrait or wide, as the box was).
export const SLOTS = ["icon", "banner", "screenshot", "boxart"];

// Hosts a picked picture may come from: the sources' own image servers, https only;
// GitHub's raw host only for the libretro-thumbnails repositories.
const HOSTS = [/^cdn\d*\.steamgriddb\.com$/, /^images\.igdb\.com$/, /(^|\.)nintendo\.(net|com)$/];
const LIBRETRO = (u) => u.hostname === "raw.githubusercontent.com" && u.pathname.startsWith("/libretro-thumbnails/");
export function allowedImageUrl(url) {
  try {
    const u = new URL(String(url));
    return u.protocol === "https:" && (HOSTS.some((re) => re.test(u.hostname)) || LIBRETRO(u));
  } catch {
    return false;
  }
}

/** The eShop's own pictures for a base title id: each language's icon or banner, or the screenshots. Pure over titledb. */
export function eshopCandidates(slot, baseTitleId) {
  if (!baseTitleId) return [];
  const rec = titledb.get(baseTitleId);
  const name = rec?.name ?? null;
  const game = name ? { id: baseTitleId, name } : null;
  const out = [];
  const add = (url, label) => {
    if (url && allowedImageUrl(url) && !out.some((c) => c.url === url)) out.push({ source: "eshop", game, label, thumb: url, url });
  };
  if (slot === "screenshot") {
    for (const url of rec?.screenshots ?? []) add(url, "");
    return out;
  }
  const perLang = (slot === "icon" ? titledb.iconsOf(baseTitleId) : titledb.bannersOf(baseTitleId)) ?? {};
  // Korean first: the Korean release's picture is the one this shop wants most.
  for (const lang of ["ko", "ja", "en", "zh"]) add(perLang[lang], lang);
  for (const [lang, url] of Object.entries(perLang)) add(url, lang);
  add(slot === "icon" ? rec?.iconUrl : rec?.bannerUrl, "");
  return out;
}

async function sgdbGet(path, apiKey, fetchImpl) {
  const res = await fetchImpl(`${SGDB}${path}`, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`SteamGridDB ${res.status}`);
  return (await res.json()).data ?? [];
}

/** SteamGridDB's square grids (icon), box covers (boxart) or heroes (banner) for the games found under `q`; nothing for screenshots. */
export async function sgdbCandidates(slot, q, apiKey, { fetchImpl = fetch } = {}) {
  if (!apiKey || slot === "screenshot") return [];
  const games = (await sgdbGet(`/search/autocomplete/${encodeURIComponent(q)}`, apiKey, fetchImpl)).slice(0, GAMES);
  const out = [];
  for (const g of games) {
    const path = slot === "icon" ? `/grids/game/${Number(g.id)}?dimensions=512x512,1024x1024&types=static`
      : slot === "boxart" ? `/grids/game/${Number(g.id)}?dimensions=600x900,342x482,660x930&types=static`
        : `/heroes/game/${Number(g.id)}?types=static`;
    for (const img of (await sgdbGet(path, apiKey, fetchImpl)).slice(0, PER_GAME)) {
      if (allowedImageUrl(img.url)) out.push({ source: "sgdb", game: { id: g.id, name: g.name }, label: "", thumb: img.thumb || img.url, url: img.url });
    }
  }
  return out;
}

const igdbImage = (size, id) => `${IGDB_IMAGES}${size}/${id}.jpg`;
const quoted = (s) => String(s).replace(/["\\]/g, " ").slice(0, 100);

/** IGDB's cover (icon, boxart), artworks (banner) or screenshots for the games found under `q`. */
export async function igdbCandidates(slot, q, { fetchImpl = fetch, ready = igdb.configured, query = igdb.query } = {}) {
  if (!ready()) return [];
  const games = await query("games", `search "${quoted(q)}"; fields name,cover.image_id,artworks.image_id,screenshots.image_id; limit ${GAMES};`, { fetchImpl });
  const out = [];
  for (const g of games ?? []) {
    const ids = slot === "icon" || slot === "boxart" ? [g.cover?.image_id] : slot === "banner" ? [...(g.artworks ?? []), ...(g.screenshots ?? [])].map((a) => a.image_id) : (g.screenshots ?? []).map((s) => s.image_id);
    for (const id of ids.filter(Boolean).slice(0, PER_GAME)) {
      out.push({ source: "igdb", game: { id: g.id, name: g.name }, label: "", thumb: igdbImage(slot === "icon" || slot === "boxart" ? "t_cover_big" : "t_screenshot_med", id), url: igdbImage("t_1080p", id) });
    }
  }
  return out;
}

/**
 * Every source's pictures for `slot`. A source that is not set up or fails is
 * left out and named in `errors`, so one bad key never empties the list.
 */
export async function searchArt({ slot, q, baseTitleId = null, first = [] }, { fetchImpl = fetch, sgdbKey = integrations.get("steamgriddb")?.apiKey ?? "", igdbReady = igdb.configured, igdbQuery = igdb.query } = {}) {
  // `first`: candidates the caller found itself (a retro game's libretro covers), allowed hosts only.
  const items = [...first.filter((c) => allowedImageUrl(c.url)), ...eshopCandidates(slot, baseTitleId)];
  const errors = [];
  const query = String(q ?? "").trim().slice(0, 100);
  const sources = {
    sgdb: () => (sgdbKey ? sgdbCandidates(slot, query, sgdbKey, { fetchImpl }) : Promise.resolve(null)),
    igdb: () => (igdbReady() ? igdbCandidates(slot, query, { fetchImpl, ready: igdbReady, query: igdbQuery }) : Promise.resolve(null)),
  };
  const missing = [];
  if (query) {
    const settled = await Promise.allSettled(Object.values(sources).map((run) => run()));
    Object.keys(sources).forEach((name, i) => {
      const r = settled[i];
      if (r.status === "rejected") errors.push(name);
      else if (r.value === null) missing.push(name);
      else items.push(...r.value);
    });
  }
  return { q: query, items, errors, missing };
}

/** A name to search the outside sources by: titledb's English name for a game, else nothing. */
export function defaultQuery(baseTitleId) {
  if (!baseTitleId) return "";
  return titledb.namesOf(baseTitleId)?.en ?? titledb.get(baseTitleId)?.name ?? "";
}

const MAGIC = [[0xff, 0xd8, 0xff], [0x89, 0x50, 0x4e, 0x47], [0x52, 0x49, 0x46, 0x46]];
const TYPES = ["image/jpeg", "image/png", "image/webp"];

/** A picked picture's bytes and type, from an allowed host only (redirects too), at most MAX_IMAGE_BYTES. */
export async function remoteImage(url, { fetchImpl = fetch } = {}) {
  let at = String(url);
  for (let hop = 0; hop < 4; hop++) {
    if (!allowedImageUrl(at)) throw new Error("고를 수 없는 그림 주소입니다");
    const res = await fetchImpl(at, { signal: AbortSignal.timeout(20_000), redirect: "manual" });
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      await res.body?.cancel?.().catch(() => {});
      at = new URL(res.headers.get("location") ?? "", at).href;
      continue;
    }
    if (!res.ok) throw new Error(`그림을 받지 못했습니다 (${res.status})`);
    if (Number(res.headers.get("content-length")) > MAX_IMAGE_BYTES) throw new Error("15 MB 보다 큰 그림입니다");
    const body = Buffer.from(await res.arrayBuffer());
    if (body.length > MAX_IMAGE_BYTES) throw new Error("15 MB 보다 큰 그림입니다");
    const i = MAGIC.findIndex((m) => m.every((b, k) => body[k] === b));
    if (i < 0) throw new Error("그림 파일이 아닙니다");
    return { body, type: TYPES[i] };
  }
  throw new Error("고를 수 없는 그림 주소입니다");
}
