/**
 * Game cards: what the chat shows for a game instead of a line of text. A tool returns them in a
 * `cards` array and the chat page draws them; the server builds each one from the library, so no
 * name, size or picture on a card comes from the model.
 *
 *   card   { kind: "switch" | "retro", id, name, platform, size, korean: { patch, ui }, icon, sendable }
 *   id     the Switch base title id (16 hex digits) or the retro game id (<system>-<10 hex>)
 *   size   bytes of the main file, or null when not known
 *   korean patch: a Korean translation patch is in the library; ui: the game has Korean text itself
 *   icon   a path on this server, or null
 *   sendable  whether the "add to my console" button applies (Switch games with a file in the library)
 */
import * as libraryCache from "../meta/library-cache.js";
import * as titledbStore from "../meta/titledb-store.js";
import * as userPatches from "../meta/user-patches.js";
import * as envs from "../helpers/envs.js";
import * as catalog from "../retro/catalog.js";
import { libraryGames } from "../meta/library-games.js";
import { titleOf } from "../retro/game-view.js";
import { versionedArtwork } from "../meta/artwork-version.js";

export const CARD_MAX = 8;
const SWITCH_ID = /^[0-9A-Fa-f]{16}$/;
const RETRO_ID = /^[a-z0-9_-]{1,24}-[0-9a-f]{10}$/;

/** Base game cards for `ids`, in the order given; an id the library does not hold is skipped. */
async function switchCards(ids) {
  if (!ids.length) return [];
  await libraryCache.get();
  const names = new Map((await libraryGames()).map((g) => [g.titleId, g.name]));
  const files = libraryCache.files();
  return ids.flatMap((id) => {
    const base = id.toUpperCase();
    const mine = files.filter((f) => f.baseTitleId === base && f.kind === "base");
    if (!mine.length && !names.has(base)) return [];
    const row = titledbStore.get(base);
    return [{
      kind: "switch",
      id: base,
      name: names.get(base) || mine[0]?.name || base,
      platform: "Nintendo Switch",
      size: mine.length ? Math.max(...mine.map((f) => f.size ?? 0)) || null : null,
      korean: { patch: userPatches.koreanFor(base) > 0, ui: Array.isArray(row?.languages) && row.languages.includes("ko") },
      icon: versionedArtwork(`/api/library/icon/${base}`),
      sendable: mine.length > 0,
    }];
  });
}

async function retroCards(ids) {
  if (!ids.length) return [];
  const cat = await catalog.current(envs.retroDir);
  return ids.flatMap((id) => {
    const g = cat.byId.get(id);
    if (!g) return [];
    const { name, edition } = titleOf(g, "ko");
    return [{
      kind: "retro",
      id: g.id,
      name,
      platform: cat.systems[g.system]?.names?.en ?? g.system,
      size: g.size ?? null,
      korean: { patch: edition?.korean === true && edition.source === "patch", ui: edition?.korean === true && edition.source !== "patch" },
      icon: g.icon ? `/api/retro/games/${g.id}/icon` : null,
      sendable: false,
    }];
  });
}

/** The cards for a mixed list of Switch and retro ids, at most CARD_MAX, in the order given; anything else is skipped. */
export async function cardsFor(ids) {
  const wanted = [...new Set((Array.isArray(ids) ? ids : []).filter((x) => typeof x === "string"))].slice(0, CARD_MAX);
  const built = new Map([
    ...(await switchCards(wanted.filter((x) => SWITCH_ID.test(x)))).map((c) => [c.id, c]),
    ...(await retroCards(wanted.filter((x) => RETRO_ID.test(x)))).map((c) => [c.id, c]),
  ]);
  return wanted.flatMap((id) => built.get(SWITCH_ID.test(id) ? id.toUpperCase() : id) ?? []);
}

const ICON_RE = /^\/api\/(?!.*\.\.)[A-Za-z0-9/_.?=&%-]{1,200}$/;
const clip = (v, max) => String(v ?? "").slice(0, max);

/**
 * `value` as a list of cards the page may draw, or []: only the fields above, each of its own
 * type, the picture only a path of this server's /api. A tool of an outside MCP server could hand
 * back anything under `cards`; this is what keeps it from reaching the page.
 */
export function cleanCards(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, CARD_MAX).flatMap((c) => {
    const kind = c?.kind === "switch" || c?.kind === "retro" ? c.kind : null;
    const id = typeof c?.id === "string" && (kind === "switch" ? SWITCH_ID : RETRO_ID).test(c.id) ? c.id : null;
    if (!kind || !id || typeof c.name !== "string") return [];
    return [{
      kind, id, name: clip(c.name, 120), platform: clip(c.platform, 60),
      size: Number.isFinite(c.size) && c.size >= 0 ? c.size : null,
      korean: { patch: c.korean?.patch === true, ui: c.korean?.ui === true },
      icon: typeof c.icon === "string" && ICON_RE.test(c.icon) ? c.icon : null,
      sendable: kind === "switch" && c.sendable === true,
    }];
  });
}
