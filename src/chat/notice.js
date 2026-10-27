/**
 * The short card shown at the top of a client (and sent to Telegram) when chat changed something:
 * who, which menu, what. The sentence is built here from the tool, its area and its numbers, never
 * from text the model wrote. Plain text only, short, and free of e-mail addresses and control
 * characters. A request that waits for an answer is "sticky" and carries approve and refuse.
 */

import { NOTICE_TEXT } from "./notice-text.js";

export const TITLE_MAX = 40;
export const BODY_MAX = 90;
const SUBJECT_MAX = 40;

const textOf = (lang) => NOTICE_TEXT[lang] ?? NOTICE_TEXT.ko;
const fill = (template, values) => template.replace(/\{(\w+)\}/g, (_, k) => values[k] ?? "");
const menuName = (t, area) => t[`menu_${area}`] ?? clean(area);
const labelName = (t, capId) => t[`label_${capId}`] ?? clean(capId);

const clean = (s) => String(s ?? "").replace(/<[^>]*>/g, "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\S+@\S+/g, "").replace(/\s+/g, " ").trim();
const cut = (s, max) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
const size = (bytes) => (Number.isFinite(bytes) && bytes > 0 ? `${Math.round(bytes / 1048576) || "<1"}MB` : "");

/** The card for one finished or waiting call, or null when it changes nothing. */
export function buildNotice({ actor, capId, area, section, outcome, change, count = 1, subject, bytes, requestId, at, lang = "ko" }) {
  if (!change) return null;
  const t = textOf(lang);
  const name = cut(clean(actor?.name) || t.someone, 20);
  const menu = [menuName(t, area), clean(section)].filter(Boolean).join(" > ");
  const label = labelName(t, capId);
  const requested = outcome === "requested" || outcome === "pending";
  const detail = [clean(subject) && cut(clean(subject), SUBJECT_MAX), size(bytes)].filter(Boolean).join(", ");
  const sentence = fill(requested ? t.asked : t.did, { name, menu, label });
  const notice = {
    kind: requested ? "request" : "applied",
    level: requested ? "action" : "info",
    sticky: requested,
    title: cut(requested ? t.titleRequest : capId === "upload_apply" ? t.titleUpload : t.titleApplied, TITLE_MAX),
    body: cut(detail ? `${sentence} (${detail})` : sentence, BODY_MAX),
    actor: name, lang, area, section: section ?? null, capId, count, at,
  };
  if (requested) {
    notice.requestId = requestId ?? null;
    notice.actions = [{ id: "approve" }, { id: "refuse" }];
  }
  return notice;
}

/** Cards of one person, one kind and one tool within `windowMs` of each other become one with a count. Requests stay apart. */
export function mergeNotices(notices, { windowMs }) {
  const out = [];
  for (const n of notices) {
    const last = out.findLast((m) => m.kind === "applied" && n.kind === "applied" && m.actor === n.actor && m.lang === n.lang && m.capId === n.capId && m.area === n.area && m.section === n.section);
    if (last && n.at - last.lastAt <= windowMs) {
      last.count += n.count;
      last.lastAt = n.at;
      const t = textOf(last.lang);
      last.body = cut(fill(t.times, { name: last.actor, menu: menuName(t, last.area), label: labelName(t, last.capId), count: last.count }), BODY_MAX);
    } else {
      out.push({ ...n, lastAt: n.at });
    }
  }
  return out;
}
