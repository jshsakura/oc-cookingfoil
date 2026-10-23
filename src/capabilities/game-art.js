/**
 * Switch game art capabilities: what each slot shows now, pictures to pick from, and setting or
 * re-cutting a slot. Every set picture is cut to its slot's shape the way the page's crop editor
 * cuts it (meta/art-fit.js), and the full picture is kept beside it so it can be cut again.
 */
import fs from "fs";
import { defineCapability } from "./define.js";
import { arr, int, nullable, num, obj, oneOf, str, titleId } from "./shape.js";
import * as customArt from "../meta/custom-art.js";
import * as artSearch from "../meta/art-search.js";
import * as titledbStore from "../meta/titledb-store.js";
import * as extractedMeta from "../meta/extracted-meta-store.js";
import { CropError, MIN_CROP_PX, parseCrop, uprightSize } from "../meta/art-crop.js";
import { ART_ASPECT, fitCrop } from "../meta/art-fit.js";
import { StuckError } from "../meta/game-art-files.js";
import { invalidate } from "../meta/shop-cache.js";

const TITLE_ID_RE = /^[0-9A-F]{16}$/;
const fail = (status, message) => Object.assign(new Error(message), { status });

function baseOf(input) {
  const base = String(input?.titleId ?? "").toUpperCase();
  if (!TITLE_ID_RE.test(base) || !base.endsWith("000")) throw fail(400, "titleId must be a base game id, 16 hex digits ending in 000");
  return base;
}

function slotOf(input) {
  if (!artSearch.SLOTS.includes(input?.slot)) throw fail(400, "slot must be icon, banner or screenshot");
  return input.slot;
}

function cropOf(input) {
  try {
    return parseCrop(input?.crop ?? null);
  } catch {
    throw fail(400, "crop must be { x, y, w, h }, each a fraction 0..1 of the picture, inside it");
  }
}

/** Which source each slot shows now: the admin's picture, titledb's, the game file's own, or none. */
function artState(base) {
  const own = customArt.list(base);
  const db = titledbStore.get(base);
  return {
    icon: own.icon ? "custom" : db?.iconUrl ? "titledb" : extractedMeta.get(base)?.iconPath ? "nacp" : null,
    banner: own.banner ? "custom" : db?.bannerUrl ? "titledb" : null,
    screenshots: { custom: own.screens, titledb: Array.isArray(db?.screenshots) ? db.screenshots.filter(Boolean).length : 0 },
  };
}

async function fetchPicture(url) {
  if (!artSearch.allowedImageUrl(String(url ?? ""))) throw fail(400, "url must be one game_art_search returned (eShop, SteamGridDB or IGDB image hosts)");
  try {
    return (await artSearch.remoteImage(String(url))).body;
  } catch {
    throw fail(400, "could not fetch that picture as an image; pick another from game_art_search");
  }
}

/** The slot index a new picture takes: null for icon and banner, the next free one for a screenshot. */
function targetIdx(base, slot) {
  if (slot !== "screenshot") return null;
  const idx = customArt.nextScreenshotIdx(base);
  if (idx === null) throw fail(409, `this game already has ${customArt.MAX_SCREENSHOTS} screenshots of its own`);
  return idx;
}

/** The area to keep, in the slot's shape, and its size in pixels. */
async function plan(picture, slot, crop) {
  const { width, height } = await readable(() => uprightSize(picture));
  const area = fitCrop(width, height, ART_ASPECT[slot], crop);
  const result = { width: Math.round(area.w * width), height: Math.round(area.h * height) };
  if (result.width < MIN_CROP_PX || result.height < MIN_CROP_PX) throw fail(400, `the area must be at least ${MIN_CROP_PX} pixels a side; it would be ${result.width}x${result.height}`);
  return { image: { width, height }, crop: area, result };
}

/** Runs a store or cut, answering its known failures as statuses an agent can act on. */
async function readable(fn) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof CropError) throw fail(400, "could not read or cut that picture; pick another one");
    if (err instanceof StuckError) throw fail(409, "a picture placed in the game's folder by hand could not be moved aside; check that folder can be written");
    throw err;
  }
}

/** A slot holding one of the admin's pictures, refusing one that holds none. */
function ownSlot(input) {
  const base = baseOf(input);
  const slot = slotOf(input);
  const idx = slot === "screenshot" ? input.idx ?? null : null;
  if (slot === "screenshot" && !Number.isInteger(idx)) throw fail(400, "idx is needed for a screenshot");
  if (!customArt.pathFor(base, slot, idx)) throw fail(404, "the admin has no picture in that slot; game_art lists them");
  return { base, slot, idx };
}

/** What each slot shows with the admin's pictures gone. */
function withoutOwn(base) {
  const db = titledbStore.get(base);
  return { icon: db?.iconUrl ? "titledb" : extractedMeta.get(base)?.iconPath ? "nacp" : null, banner: db?.bannerUrl ? "titledb" : null };
}

function keptOriginal(base, slot, idx) {
  const kept = customArt.original(base, slot, idx);
  if (!kept) throw fail(404, "no full picture is kept for that slot; set it with game_art_set first");
  return kept;
}

const SHOWN = obj({
  icon: nullable(oneOf(["custom", "titledb", "nacp"], "custom: the admin's; titledb: the eShop's; nacp: the game file's own")),
  banner: nullable(oneOf(["custom", "titledb"])),
  screenshots: obj({ custom: arr(int(), "the admin's screenshot slots"), titledb: int("eShop screenshots") }),
});
const CROP = obj({ x: num(), y: num(), w: num(), h: num() }, { description: "area kept, fractions 0..1 of the picture" });
const SIZE = obj({ width: int(), height: int() });
const CROP_ARG = {
  type: "object",
  description: "Area {x,y,w,h} as fractions 0..1, fitted to the slot shape; largest centered when omitted",
  properties: { x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" } },
};
const TITLE_ARG = { type: "string", description: "Base game title ID (16 hex, ends in 000) from games_search" };
const SLOT_ARG = { type: "string", enum: artSearch.SLOTS, description: "icon (square), banner (16:9) or screenshot (16:9)" };
const SHAPES = "icon is square, banner and screenshot 16:9";

export const gameArtCapabilities = [
  defineCapability({
    id: "game_art",
    area: "games",
    title: "A game's art",
    description: "Which picture each art slot of a Switch game shows (the admin's, eShop's, the game file's, or none) and the area each of the admin's pictures was cut to.",
    input: { type: "object", properties: { titleId: TITLE_ARG }, required: ["titleId"] },
    output: obj({
      titleId: titleId(),
      shown: SHOWN,
      crops: obj({ icon: nullable(CROP), banner: nullable(CROP), screens: { type: "object", description: "screenshot slot -> area" } }, { description: "areas the admin's pictures were cut to; null when no full picture is kept" }),
    }),
    safety: "read",
    token: true,
    handler: async (ctx, input) => {
      const base = baseOf(input);
      return { titleId: base, shown: artState(base), crops: customArt.originals(base) };
    },
  }),
  defineCapability({
    id: "game_art_search",
    area: "games",
    title: "Find art for a game",
    description: `Pictures for one art slot of a Switch game from eShop, SteamGridDB and IGDB, with thumbnails. Set one with game_art_set; ${SHAPES}.`,
    input: {
      type: "object",
      properties: {
        titleId: TITLE_ARG,
        slot: SLOT_ARG,
        q: { type: "string", description: "Title to search SteamGridDB and IGDB with; the game's English name when left out" },
      },
      required: ["titleId", "slot"],
    },
    output: obj({
      q: str("the title searched"),
      items: arr(obj({ source: oneOf(["eshop", "sgdb", "igdb"]), game: nullable(obj({ id: { type: ["integer", "string"] }, name: str() })), label: nullable(str()), thumb: str("small preview url"), url: str("full picture, for game_art_set") }, { optional: ["label"] })),
      errors: arr(str(), "sources that failed this time"),
      missing: arr(str(), "sources without a key set"),
    }),
    safety: "read",
    token: true,
    handler: async (ctx, input) => {
      const base = baseOf(input);
      const slot = slotOf(input);
      const q = String(input.q ?? "").trim().slice(0, 100) || artSearch.defaultQuery(base);
      return artSearch.searchArt({ slot, q, baseTitleId: base });
    },
  }),
  defineCapability({
    id: "game_art_set",
    area: "games",
    title: "Set a game's art",
    description: "Uses a game_art_search picture as a game's icon, banner or a new screenshot, cut to the slot's shape. The preview gives its size and area.",
    input: {
      type: "object",
      properties: {
        titleId: TITLE_ARG,
        slot: SLOT_ARG,
        url: { type: "string", description: "The picture url (items[].url) from game_art_search" },
        crop: CROP_ARG,
      },
      required: ["titleId", "slot", "url"],
    },
    output: obj({ slot: str(), idx: nullable(int("screenshot slot")), bytes: int("size of the stored picture"), crop: CROP }),
    preview: async (ctx, input) => {
      const base = baseOf(input);
      const slot = slotOf(input);
      const crop = cropOf(input);
      const idx = targetIdx(base, slot);
      const p = await plan(await fetchPicture(input.url), slot, crop);
      const shown = artState(base);
      const replaces = slot === "screenshot" ? null : shown[slot];
      return {
        titleId: base, slot, idx, ...p, replaces,
        changes: slot === "screenshot"
          ? `Adds screenshot slot ${idx}.`
          : replaces === "custom" ? `Replaces the admin's ${slot}; pictures put in the game's folder by hand move to its .replaced folder.` : `Shows this ${slot} instead of ${replaces ?? "none"}; titledb's stays untouched underneath.`,
      };
    },
    previewOutput: obj({
      titleId: titleId(), slot: str(), idx: nullable(int()), image: SIZE, crop: CROP, result: SIZE,
      replaces: nullable(str("what the slot shows now: custom, titledb, nacp or null")), changes: str(),
    }),
    safety: "write",
    token: true,
    handler: async (ctx, input) => {
      const base = baseOf(input);
      const slot = slotOf(input);
      const crop = cropOf(input);
      const idx = targetIdx(base, slot);
      const picture = await fetchPicture(input.url);
      const { crop: area } = await plan(picture, slot, crop);
      const r = await readable(() => customArt.put(base, slot, idx, picture, area));
      invalidate();
      return { slot, idx, bytes: r.bytes, crop: area };
    },
  }),
  defineCapability({
    id: "game_art_crop",
    area: "games",
    title: "Cut a game's art again",
    description: "Cuts one of the admin's pictures again from the full picture kept when it was set, to a new area in the slot's shape.",
    input: {
      type: "object",
      properties: {
        titleId: TITLE_ARG,
        slot: SLOT_ARG,
        idx: { type: "integer", description: "Screenshot slot from game_art; only with slot screenshot" },
        crop: CROP_ARG,
      },
      required: ["titleId", "slot"],
    },
    output: obj({ slot: str(), idx: nullable(int()), bytes: int(), crop: CROP }),
    preview: async (ctx, input) => {
      const base = baseOf(input);
      const slot = slotOf(input);
      const idx = slot === "screenshot" ? input.idx ?? null : null;
      if (slot === "screenshot" && !Number.isInteger(idx)) throw fail(400, "idx is needed for a screenshot");
      const kept = keptOriginal(base, slot, idx);
      const p = await plan(await fs.promises.readFile(kept.image), slot, cropOf(input));
      return { titleId: base, slot, idx, now: kept.crop ?? null, ...p, changes: `Cuts the ${slot} again to the new area. The full picture stays kept.` };
    },
    previewOutput: obj({ titleId: titleId(), slot: str(), idx: nullable(int()), now: nullable(CROP), image: SIZE, crop: CROP, result: SIZE, changes: str() }),
    safety: "write",
    token: true,
    handler: async (ctx, input) => {
      const base = baseOf(input);
      const slot = slotOf(input);
      const idx = slot === "screenshot" ? input.idx ?? null : null;
      if (slot === "screenshot" && !Number.isInteger(idx)) throw fail(400, "idx is needed for a screenshot");
      const kept = keptOriginal(base, slot, idx);
      const { crop } = await plan(await fs.promises.readFile(kept.image), slot, cropOf(input));
      const r = await readable(() => customArt.recrop(base, slot, idx, crop));
      invalidate();
      return { slot, idx, bytes: r.bytes, crop };
    },
  }),
  defineCapability({
    id: "game_art_remove",
    area: "games",
    title: "Remove a game's own art",
    description: "Moves one of the admin's pictures (and its kept original) to the trash; the slot then shows eShop's or the game file's again. trash_restore undoes it.",
    input: {
      type: "object",
      properties: {
        titleId: TITLE_ARG,
        slot: SLOT_ARG,
        idx: { type: "integer", description: "Screenshot slot from game_art; only with slot screenshot" },
      },
      required: ["titleId", "slot"],
    },
    output: obj({ trash: str("trash entry id, for trash_restore") }),
    preview: async (ctx, input) => {
      const { base, slot, idx } = ownSlot(input);
      const after = slot === "screenshot" ? null : withoutOwn(base)[slot];
      return {
        titleId: base, slot, idx, crop: customArt.original(base, slot, idx)?.crop ?? null, after,
        changes: `Moves the admin's ${slot}${idx === null ? "" : ` ${idx}`} and its kept original to the trash; the slot then shows ${after ?? (slot === "screenshot" ? "the remaining screenshots" : "nothing")}. trash_restore with the returned id brings it back.`,
      };
    },
    previewOutput: obj({
      titleId: titleId(), slot: str(), idx: nullable(int()), crop: nullable(CROP),
      after: nullable(str("what the slot shows once it is gone: titledb, nacp or null")), changes: str(),
    }),
    safety: "write",
    token: true,
    handler: async (ctx, input) => {
      const { base, slot, idx } = ownSlot(input);
      const out = await readable(() => customArt.remove(base, slot, idx, { by: ctx?.by ?? { type: "token", name: "mcp" } }));
      invalidate();
      return { trash: out.id };
    },
  }),
];
