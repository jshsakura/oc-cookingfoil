/**
 * What tells the versions of one game apart on the HOME menu, where every
 * version's shortcut would otherwise carry the same title: "한글 v2", "정발",
 * "일본". Only games with more than one version get one; a lone version keeps
 * its plain name, so its shortcut is not built again. Pure.
 */
import { REGIONS } from "./filters.js";

const MAX_TAG = 24;

/** The short label of one version from its title parts ({ edition, region, variant }), or null. */
export function versionLabel({ edition = null, region = null, variant = null } = {}) {
  if (edition?.korean) return [edition.source === "official" ? "정발" : "한글", edition.version].filter(Boolean).join(" ");
  if (region && REGIONS[region]) return REGIONS[region].ko;
  const tag = String(variant ?? "").replace(/^[[(]|[\])]$/g, "").trim();
  return tag ? tag.slice(0, MAX_TAG) : null;
}

/**
 * id → label for the members of one group, each `{ id, parts }`. Labels two
 * versions share fall back to the version's own tag, so no two shortcuts read
 * the same; a version nothing tells apart gets none.
 */
export function versionLabels(members) {
  if (members.length < 2) return new Map();
  const first = members.map((m) => [m.id, versionLabel(m.parts)]);
  const count = new Map();
  for (const [, l] of first) if (l) count.set(l, (count.get(l) ?? 0) + 1);
  return new Map(first.map(([id, l], i) => {
    if (l && count.get(l) === 1) return [id, l];
    const tag = versionLabel({ variant: members[i].parts.variant });
    return [id, tag && tag !== l ? (l ? `${l} ${tag}` : tag) : l];
  }).filter(([, l]) => l));
}
