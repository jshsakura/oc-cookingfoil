/**
 * The words an art job shows in the activity list: the consoles by their names
 * (systems.js `names`), never their ids. Pure.
 */
import { retroText } from "../retro-messages.js";

// More consoles than this: the first two by name and a count of the rest.
const LISTED = 3;

/** A console's name in `lang`, else in English, else its id. */
export const systemName = (systems, id, lang) => systems[id]?.names?.[lang] ?? systems[id]?.names?.en ?? id;

/** The title of an art job over `ids`, or over every console when `ids` is null. */
export function artJobTitle(systems, ids, lang) {
  if (!ids?.length) return retroText(lang, "art.job");
  const names = ids.map((id) => systemName(systems, id, lang));
  if (names.length <= LISTED) return retroText(lang, "art.jobSystem", { system: names.join(", ") });
  return retroText(lang, "art.jobSystemsMore", { systems: names.slice(0, 2).join(", "), more: names.length - 2 });
}
