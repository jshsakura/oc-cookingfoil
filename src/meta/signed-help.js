/**
 * The "cannot install" help for a file that is not signed, in one language (words in
 * signed-words.js): { title, body } when the content signature, the ticket or both are false; null
 * when neither is. Pure.
 */
import { SIGNED_WORDS } from "./signed-words.js";

const FALLBACK_LANG = "en";
const wordsFor = (lang) => SIGNED_WORDS[lang] ?? SIGNED_WORDS[String(lang ?? "").split("-")[0]] ?? SIGNED_WORDS[FALLBACK_LANG];

export function signedHelp(signed, lang) {
  const nca = signed?.nca === false;
  const ticket = signed?.ticket === false;
  if (!nca && !ticket) return null;
  const w = wordsFor(lang);
  return { title: w.title, body: w[nca && ticket ? "both" : nca ? "nca" : "ticket"] };
}
