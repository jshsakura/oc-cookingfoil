/**
 * The file check's finding as the console and the admin page show it: a label,
 * and help that says what was found, what it means, what an install does and
 * what to do (words in integrity-help-words.js).
 *
 *   summary(finding)        { reason, certain, present? }: small, for the shop list
 *   explain(finding, lang)  summary plus { label, help: { title, body } } in one language
 *
 * `certain`: the install surely fails (a cut-off or missing part, an unreadable
 * file). A hash mismatch may still install, so its label says "possibly".
 * A modified file installs as a rule; it is not damage. Pure.
 */
import { INTEGRITY_WORDS } from "./integrity-help-words.js";

const FALLBACK_LANG = "en";
const UNCERTAIN = new Set(["hash-mismatch"]);
const REASON_OF = { modified: "signature-fail", damaged: "unreadable" };

/** The small part the shop list carries, or null for no finding. */
export function summary(finding) {
  if (!finding?.verdict) return null;
  const reason = finding.reason ?? REASON_OF[finding.verdict] ?? null;
  const out = { reason, certain: finding.verdict === "damaged" && !UNCERTAIN.has(reason) };
  if (reason === "truncated" && finding.detail?.present != null) out.present = finding.detail.present;
  return out;
}

const wordsFor = (lang) => INTEGRITY_WORDS[lang] ?? INTEGRITY_WORDS[String(lang ?? "").split("-")[0]] ?? INTEGRITY_WORDS[FALLBACK_LANG];

/** The finding with its label and help in `lang` (its base language, then English), or null. */
export function explain(finding, lang) {
  const s = summary(finding);
  if (!s) return null;
  const w = wordsFor(lang);
  const labelKey = finding.verdict === "modified" ? "modified" : s.certain ? "damaged" : "damaged-maybe";
  const text = w.help[s.reason] ?? w.help[REASON_OF[finding.verdict]];
  const named = (finding.detail?.ncas ?? []).map((n) => w.parts[n.type] ?? w.parts.unknown);
  const parts = [...new Set(named)].join(", ") || w.parts.unknown;
  const p = s.present != null ? Math.round(s.present * 100) : null;
  return { ...s, label: w.label[labelKey], help: { title: text.title, body: text.body({ p, parts }) } };
}
