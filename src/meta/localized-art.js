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

/** A ?lang= value we hold art for, or null. */
export function artLang(value) {
  const lang = String(value ?? "").toLowerCase();
  return LOCALIZED_LANGS.includes(lang) ? lang : null;
}

/** Where a language's icon comes from: { url } (eShop), { file: true } (game file), or null for the default. */
export function iconSource(baseTitleId, lang) {
  if (!lang || customArt.hasOverride(baseTitleId, "icon")) return null;
  const url = titledbStore.iconsOf(baseTitleId)?.[lang];
  if (url && url !== titledbStore.get(baseTitleId)?.iconUrl) return { url };
  if (extractedMeta.get(baseTitleId)?.iconLangs?.includes(lang)) return { file: true };
  return null;
}

/** The eShop banner URL for a language when it differs from the default, or null. */
export function bannerSource(baseTitleId, lang) {
  if (!lang || customArt.hasOverride(baseTitleId, "banner")) return null;
  const url = titledbStore.bannersOf(baseTitleId)?.[lang];
  return url && url !== titledbStore.get(baseTitleId)?.bannerUrl ? url : null;
}

/** Languages with their own icon, in LOCALIZED_LANGS order. */
export function iconLangs(baseTitleId) {
  return LOCALIZED_LANGS.filter((lang) => iconSource(baseTitleId, lang));
}
