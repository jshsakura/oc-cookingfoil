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
  "korean-patch": label(10, "accent", "globe", { en: "Korean patch", ko: "한글패치", ja: "韓国語パッチ", zh: "韩化补丁", "zh-Hant": "韓化補丁", es: "Parche coreano", fr: "Patch coréen", de: "Koreanischer Patch", it: "Patch coreana", pt: "Patch coreano", ru: "Корейский патч", nl: "Koreaanse patch" }),
  "required-patch": label(20, "warn", "wrench", { en: "Required patch", ko: "필수 패치", ja: "必須パッチ", zh: "必需补丁", "zh-Hant": "必需補丁", es: "Parche necesario", fr: "Patch requis", de: "Erforderlicher Patch", it: "Patch necessaria", pt: "Patch necessário", ru: "Обязательный патч", nl: "Vereiste patch" }),
  damaged: label(30, "bad", "alert", { en: "May be damaged", ko: "손상 의심", ja: "破損の疑い", zh: "疑似损坏", "zh-Hant": "疑似損壞", es: "Posiblemente dañado", fr: "Peut-être endommagé", de: "Möglicherweise beschädigt", it: "Forse danneggiato", pt: "Pode estar danificado", ru: "Возможно повреждён", nl: "Mogelijk beschadigd" }),
  modified: label(31, "warn", "info", { en: "Modified", ko: "수정됨", ja: "改変あり", zh: "已修改", "zh-Hant": "已修改", es: "Modificado", fr: "Modifié", de: "Verändert", it: "Modificato", pt: "Modificado", ru: "Изменён", nl: "Aangepast" }),
  latest: label(32, "good", "check", { en: "Latest version", ko: "최신 버전", ja: "最新バージョン", zh: "最新版本", "zh-Hant": "最新版本", es: "Última versión", fr: "Dernière version", de: "Neueste Version", it: "Ultima versione", pt: "Versão mais recente", ru: "Последняя версия", nl: "Nieuwste versie" }),
  update: label(33, "neutral", "download", { en: "Update", ko: "업데이트", ja: "アップデート", zh: "更新", "zh-Hant": "更新", es: "Actualización", fr: "Mise à jour", de: "Update", it: "Aggiornamento", pt: "Atualização", ru: "Обновление", nl: "Update" }),
  sale: label(40, "accent", "tag", { en: "eShop sale", ko: "eShop 할인", ja: "eShop セール", zh: "eShop 折扣", "zh-Hant": "eShop 折扣", es: "Oferta en eShop", fr: "Promo eShop", de: "eShop-Angebot", it: "Offerta eShop", pt: "Promoção eShop", ru: "Скидка в eShop", nl: "eShop-aanbieding" }),
  dlc: label(50, "neutral", "package", { en: "DLC {0}", ko: "DLC {0}", ja: "DLC {0}", zh: "DLC {0}", "zh-Hant": "DLC {0}", es: "DLC {0}", fr: "DLC {0}", de: "DLC {0}", it: "DLC {0}", pt: "DLC {0}", ru: "DLC {0}", nl: "DLC {0}" }),
};

export const RETRO_LABELS = {
  achievements: label(10, "accent", "trophy", { en: "Achievements {0}", ko: "업적 {0}", ja: "実績 {0}", zh: "成就 {0}", "zh-Hant": "成就 {0}", es: "Logros {0}", fr: "Succès {0}", de: "Erfolge {0}", it: "Obiettivi {0}", pt: "Conquistas {0}", ru: "Достижения {0}", nl: "Prestaties {0}" }),
  // Found by its title rather than its ROM's hash, so this ROM may not earn them.
  "achievements-title": label(11, "neutral", "trophy", { en: "Achievements {0}", ko: "업적 {0}", ja: "実績 {0}", zh: "成就 {0}", "zh-Hant": "成就 {0}", es: "Logros {0}", fr: "Succès {0}", de: "Erfolge {0}", it: "Obiettivi {0}", pt: "Conquistas {0}", ru: "Достижения {0}", nl: "Prestaties {0}" }),
  korean: label(20, "neutral", null, { en: "Korean", ko: "한글", ja: "韓国語", zh: "韩文", "zh-Hant": "韓文", es: "Coreano", fr: "Coréen", de: "Koreanisch", it: "Coreano", pt: "Coreano", ru: "Корейский", nl: "Koreaans" }),
  year: label(30, "neutral", null, { en: "{0}", ko: "{0}", ja: "{0}", zh: "{0}", "zh-Hant": "{0}", es: "{0}", fr: "{0}", de: "{0}", it: "{0}", pt: "{0}", ru: "{0}", nl: "{0}" }),
  players: label(40, "neutral", null, { en: "{0}P", ko: "{0}인", ja: "{0}人", zh: "{0}人", "zh-Hant": "{0}人", es: "{0} jug.", fr: "{0} j.", de: "{0} Sp.", it: "{0} gioc.", pt: "{0} jog.", ru: "Игроки: {0}", nl: "{0} sp." }),
};

/**
 * Notices for a console, in the client's twelve languages. `shortcutsStale`: the console plays with another core
 * than its HOME menu shortcuts were built for, so the shortcuts have to be downloaded again.
 */
export const RETRO_NOTICES = {
  shortcutsStale: { en: "The core changed. Download the HOME menu shortcuts again.", ko: "코어가 바뀌어 홈 메뉴 바로가기를 다시 받아야 합니다.", ja: "コアが変わったため、HOMEメニューのショートカットをダウンロードし直してください。", zh: "核心已更改,请重新下载主页菜单快捷方式。", "zh-Hant": "核心已變更,請重新下載主畫面選單捷徑。", es: "El núcleo ha cambiado. Vuelve a descargar los accesos directos del menú HOME.", fr: "Le cœur a changé. Retéléchargez les raccourcis du menu HOME.", de: "Der Core hat sich geändert. Lade die HOME-Menü-Verknüpfungen erneut herunter.", it: "Il core è cambiato. Scarica di nuovo le scorciatoie del menu HOME.", pt: "O núcleo mudou. Baixe novamente os atalhos do menu HOME.", ru: "Ядро изменилось. Скачайте ярлыки меню HOME заново.", nl: "De core is gewijzigd. Download de HOME-menusnelkoppelingen opnieuw." },
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
