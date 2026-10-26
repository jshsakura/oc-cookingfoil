/**
 * Box art in the page language. A game's icon carries its title in the
 * region's own script, so an English or Japanese screen wants that language's
 * icon: the game file's own icon_<Language>.dat, saved by nacp-extractor.js as
 * data/icons/<id>.icon.<lang>.jpg where it differs from the default icon.
 * The file on disk is what counts; nothing records it elsewhere.
 *
 * Only languages whose art differs from the default are listed; a client
 * uses the default for the rest. Art the operator uploaded wins outright.
 * Banners are drawn from the icon (icon-banner.js), so they follow it.
 */
import * as customArt from "./custom-art.js";
import { LOCALIZED_LANGS } from "./titledb-store.js";
import { parseLang } from "./langs.js";
import { cachePathFor, hasCached } from "./image-cache.js";

/** A ?lang= value we hold art for, or null. */
export function artLang(value) {
  return parseLang(value);
}

/** Whether `lang` has an icon of its own in the game file (one that differs from the default). */
export function iconSource(baseTitleId, lang) {
  if (!lang || customArt.hasOverride(baseTitleId, "icon")) return null;
  return hasCached(cachePathFor(baseTitleId, "icon-lang", lang)) ? { file: true } : null;
}

/** Whether a language has an icon, the default one included (a custom icon stands for every language). */
export const iconKnown = (baseTitleId, lang) =>
  customArt.hasOverride(baseTitleId, "icon") || Boolean(iconSource(baseTitleId, lang)) || hasCached(cachePathFor(baseTitleId, "icon"));

/** Whether a language has a banner, the default one included: any icon gives one. */
export const bannerKnown = (baseTitleId, lang) =>
  customArt.hasOverride(baseTitleId, "banner") || iconKnown(baseTitleId, lang);

/** The language whose own banner is drawn (its own icon), or null for the default. */
export function bannerSource(baseTitleId, lang) {
  if (!lang || customArt.hasOverride(baseTitleId, "banner")) return null;
  return iconSource(baseTitleId, lang) ? lang : null;
}

/** Languages with their own icon, in LOCALIZED_LANGS order. */
export function iconLangs(baseTitleId) {
  return LOCALIZED_LANGS.filter((lang) => iconSource(baseTitleId, lang));
}
