/**
 * Box art in the page language. A game's icon and banner carry its title in
 * the region's own script, so an English or Japanese screen wants that
 * region's art: the eShop's per-region icon/banner (titledb), or for a game
 * titledb does not know, the game file's own icon_<Language>.dat.
 *
 * Only languages whose art differs from the default are listed; a client
 * uses the default for the rest. Art the operator uploaded wins outright.
 */
import * as titledbStore from "./titledb-store.js";
import * as extractedMeta from "./extracted-meta-store.js";
import * as customArt from "./custom-art.js";
import { LOCALIZED_LANGS } from "./titledb-store.js";
import { parseLang } from "./langs.js";

// Languages whose art is listed even when it matches English's; the others only where it differs from it.
const CORE = new Set(["ko", "en", "ja", "zh"]);

/** A ?lang= value we hold art for, or null. */
export function artLang(value) {
  return parseLang(value);
}

/** Where a language's icon comes from: { url } (eShop), { file: true } (game file), or null for the default. */
export function iconSource(baseTitleId, lang) {
  if (!lang || customArt.hasOverride(baseTitleId, "icon")) return null;
  const url = titledbStore.iconsOf(baseTitleId)?.[lang];
  if (url && url !== titledbStore.get(baseTitleId)?.iconUrl) return { url };
  if (extractedMeta.get(baseTitleId)?.iconLangs?.includes(lang)) return { file: true };
  return null;
}

/** Whether a language has an icon of its own, the default one included (a custom icon stands for every language). */
export const iconKnown = (baseTitleId, lang) =>
  customArt.hasOverride(baseTitleId, "icon") || Boolean(titledbStore.iconsOf(baseTitleId)?.[lang]) || Boolean(extractedMeta.get(baseTitleId)?.iconLangs?.includes(lang));

/** Whether a language has a banner of its own, the default one included. */
export const bannerKnown = (baseTitleId, lang) =>
  customArt.hasOverride(baseTitleId, "banner") || Boolean(titledbStore.bannersOf(baseTitleId)?.[lang]);

/** The eShop banner URL for a language when it differs from the default, or null. */
export function bannerSource(baseTitleId, lang) {
  if (!lang || customArt.hasOverride(baseTitleId, "banner")) return null;
  const url = titledbStore.bannersOf(baseTitleId)?.[lang];
  return url && url !== titledbStore.get(baseTitleId)?.bannerUrl ? url : null;
}

/**
 * Languages with their own icon, in LOCALIZED_LANGS order. A language past the
 * first four is listed only when its art differs from English's, which a client
 * falls back to.
 */
export function iconLangs(baseTitleId) {
  const en = iconSource(baseTitleId, "en");
  return LOCALIZED_LANGS.filter((lang) => {
    const own = iconSource(baseTitleId, lang);
    return own && (CORE.has(lang) || !en || own.url !== en.url || own.file);
  });
}
