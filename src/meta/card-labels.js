/**
 * The labels under a card's name, decided here so the client only draws them.
 *
 * A list response carries the dictionary once at its top ("labels": key → its
 * text per language, tone, icon, order) and each item carries only keys in the
 * order to draw them: "korean-patch" alone, or ["dlc", "3"] when the text has a
 * {0} to fill. A client skips a key its dictionary lacks, so a new kind of
 * label needs only a change here.
 *
 * tone: accent | neutral | good | warn | bad. icon: a name from the client's
 * icon set, or none. order: where a label the client adds on its own would go.
 * "one" (per language) is the text for a value of "1" where it differs.
 */

const label = (order, tone, icon, text) => ({ ...text, tone, ...(icon ? { icon } : {}), order });

export const SWITCH_LABELS = {
  "korean-patch": label(10, "accent", "globe", { en: "Korean patch", ko: "한글패치", ja: "韓国語パッチ", zh: "韩化补丁" }),
  "required-patch": label(20, "warn", "wrench", { en: "Required patch", ko: "필수 패치", ja: "必須パッチ", zh: "必需补丁" }),
  damaged: label(30, "bad", "alert", { en: "May be damaged", ko: "손상 의심", ja: "破損の疑い", zh: "疑似损坏" }),
  modified: label(31, "warn", "info", { en: "Modified", ko: "수정됨", ja: "改変あり", zh: "已修改" }),
  latest: label(32, "good", "check", { en: "Latest version", ko: "최신 버전", ja: "最新バージョン", zh: "最新版本" }),
  update: label(33, "neutral", "download", { en: "Update", ko: "업데이트", ja: "アップデート", zh: "更新" }),
  sale: label(40, "accent", "tag", { en: "eShop sale", ko: "eShop 할인", ja: "eShop セール", zh: "eShop 折扣" }),
  dlc: label(50, "neutral", "package", { en: "DLC {0}", ko: "DLC {0}", ja: "DLC {0}", zh: "DLC {0}" }),
};

export const RETRO_LABELS = {
  achievements: label(10, "accent", "trophy", { en: "Achievements {0}", ko: "업적 {0}", ja: "実績 {0}", zh: "成就 {0}" }),
  // Found by its title rather than its ROM's hash, so this ROM may not earn them.
  "achievements-title": label(11, "neutral", "trophy", { en: "Achievements {0}", ko: "업적 {0}", ja: "実績 {0}", zh: "成就 {0}" }),
  korean: label(20, "neutral", null, { en: "Korean", ko: "한글", ja: "韓国語", zh: "韩文" }),
  year: label(30, "neutral", null, { en: "{0}", ko: "{0}", ja: "{0}", zh: "{0}" }),
  players: label(40, "neutral", null, { en: "{0}P", ko: "{0}인", ja: "{0}人", zh: "{0}人" }),
};

const INTEGRITY_RANK = { modified: 1, damaged: 2 };

/**
 * Labels for every base item, from what the whole catalog holds of its game:
 * its updates and DLC sit in other items under the same base_title_id.
 * The file-state slot holds one label: damaged > modified > latest > update.
 */
export function attachSwitchLabels(items) {
  const games = new Map();
  for (const item of items) {
    const base = item.base_title_id;
    if (!base) continue;
    const game = games.get(base) ?? { update: -1, dlc: 0, integrity: 0 };
    if (item.app_type === "update") game.update = Math.max(game.update, item.app_version ?? 0);
    if (item.app_type === "dlc") game.dlc++;
    game.integrity = Math.max(game.integrity, INTEGRITY_RANK[item.integrity] ?? 0);
    games.set(base, game);
  }
  for (const item of items) {
    if (item.app_type !== "base") continue;
    const game = games.get(item.base_title_id);
    const labels = [];
    if (item.korean_patches) labels.push("korean-patch");
    if (item.required_patches) labels.push("required-patch");
    if (game.integrity) labels.push(game.integrity === 2 ? "damaged" : "modified");
    else if (game.update >= 0) labels.push(item.latest_version && game.update >= item.latest_version ? "latest" : "update");
    if (item.price_discount) labels.push("sale");
    if (game.dlc) labels.push(["dlc", String(game.dlc)]);
    if (labels.length) item.labels = labels;
  }
  return items;
}

/** A retro game's labels: { achievements?: { count, matchedBy }, korean, year?, players? }. */
export function retroLabels({ achievements, korean, year, players }) {
  const labels = [];
  if (achievements?.count > 0) labels.push([achievements.matchedBy === "title" ? "achievements-title" : "achievements", String(achievements.count)]);
  if (korean) labels.push("korean");
  if (year) labels.push(["year", String(year)]);
  if (players > 1) labels.push(["players", String(players)]);
  return labels;
}
