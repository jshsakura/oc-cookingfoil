/**
 * Why a rewrap was refused, in the twelve client languages: the console shows
 * `error` as it comes. A RewrapError carries the English text, the key here as
 * `code` ("rewrap.keysTooOld") and the placeholder values as `vars`; the
 * serving route answers in the request's language by that code (refusalBody).
 * `detail` is English for the server log only.
 */
import { LANGS, requestLang } from "../langs.js";

export const REWRAP_WORDS = {
  en: {
    noKeys: "This server has no console keys (prod.keys), so it cannot prepare this game for an older firmware.",
    badTarget: "The console sent a firmware key generation the server does not understand.",
    keysTooOld: "The server's prod.keys is too old to continue. Replace it with prod.keys from firmware {version} or later.",
    keyMissing: "The server's prod.keys lacks a generation {gen} key (firmware {firmware}) that this change needs.",
    unsupported: "The server cannot prepare this file for an older firmware: its layout is not one it can change.",
    personalTicket: "This game's ticket is tied to one console, so the server cannot prepare it for an older firmware.",
  },
  ko: {
    noKeys: "서버에 콘솔 키(prod.keys)가 없어 이 게임을 낮은 펌웨어용으로 바꿀 수 없습니다.",
    badTarget: "기기가 보낸 펌웨어 키 세대를 서버가 알아보지 못했습니다.",
    keysTooOld: "서버 prod.keys 의 버전이 낮아 진행할 수 없습니다. {version} 이상 버전의 prod.keys 로 교체해 주세요.",
    keyMissing: "서버의 prod.keys 에 이 변환에 필요한 {gen}세대(펌웨어 {firmware}) 키가 없습니다.",
    unsupported: "서버가 바꿀 수 있는 파일 구조가 아니라 낮은 펌웨어용으로 준비하지 못했습니다.",
    personalTicket: "이 게임의 티켓은 한 기기에 묶여 있어 낮은 펌웨어용으로 바꿀 수 없습니다.",
  },
  ja: {
    noKeys: "サーバーにコンソールキー(prod.keys)がないため、このゲームを古いファームウェア向けに変換できません。",
    badTarget: "本体が送ったファームウェアのキー世代をサーバーが認識できませんでした。",
    keysTooOld: "サーバーの prod.keys のバージョンが古いため続行できません。{version} 以降の prod.keys に置き換えてください。",
    keyMissing: "この変換に必要な第{gen}世代(ファームウェア {firmware})のキーがサーバーの prod.keys にありません。",
    unsupported: "サーバーが変更できるファイル構造ではないため、古いファームウェア向けに準備できませんでした。",
    personalTicket: "このゲームのチケットは一台の本体に結び付いているため、古いファームウェア向けに変換できません。",
  },
  zh: {
    noKeys: "服务器没有主机密钥(prod.keys),无法将此游戏转换为适用于旧固件的版本。",
    badTarget: "服务器无法识别主机发送的固件密钥代数。",
    keysTooOld: "服务器的 prod.keys 版本过低，无法继续。请换成 {version} 或更高版本的 prod.keys。",
    keyMissing: "服务器的 prod.keys 缺少此转换所需的第 {gen} 代(固件 {firmware})密钥。",
    unsupported: "此文件的结构不是服务器能够修改的,因此无法为旧固件准备。",
    personalTicket: "此游戏的票据绑定在一台主机上,无法转换为适用于旧固件的版本。",
  },
  "zh-Hant": {
    noKeys: "伺服器沒有主機金鑰(prod.keys),無法將此遊戲轉換為適用於舊韌體的版本。",
    badTarget: "伺服器無法辨識主機傳送的韌體金鑰世代。",
    keysTooOld: "伺服器的 prod.keys 版本過低，無法繼續。請換成 {version} 或更高版本的 prod.keys。",
    keyMissing: "伺服器的 prod.keys 缺少此轉換所需的第 {gen} 代(韌體 {firmware})金鑰。",
    unsupported: "此檔案的結構不是伺服器能夠修改的,因此無法為舊韌體準備。",
    personalTicket: "此遊戲的票證綁定在一台主機上,無法轉換為適用於舊韌體的版本。",
  },
  es: {
    noKeys: "Este servidor no tiene las claves de la consola (prod.keys), así que no puede preparar este juego para un firmware anterior.",
    badTarget: "La consola envió una generación de claves de firmware que el servidor no entiende.",
    keysTooOld: "El prod.keys del servidor es demasiado antiguo para continuar. Sustitúyelo por un prod.keys del firmware {version} o posterior.",
    keyMissing: "Al prod.keys del servidor le falta una clave de la generación {gen} (firmware {firmware}) que este cambio necesita.",
    unsupported: "El servidor no puede preparar este archivo para un firmware anterior: su estructura no es una que pueda cambiar.",
    personalTicket: "El ticket de este juego está ligado a una sola consola, así que el servidor no puede prepararlo para un firmware anterior.",
  },
  fr: {
    noKeys: "Ce serveur n'a pas les clés de la console (prod.keys) et ne peut donc pas préparer ce jeu pour un firmware plus ancien.",
    badTarget: "La console a envoyé une génération de clés de firmware que le serveur ne comprend pas.",
    keysTooOld: "Le prod.keys du serveur est trop ancien pour continuer. Remplacez-le par un prod.keys du firmware {version} ou plus récent.",
    keyMissing: "Le prod.keys du serveur n'a pas une clé de la génération {gen} (firmware {firmware}) dont ce changement a besoin.",
    unsupported: "Le serveur ne peut pas préparer ce fichier pour un firmware plus ancien : sa structure n'est pas de celles qu'il sait modifier.",
    personalTicket: "Le ticket de ce jeu est lié à une seule console, le serveur ne peut donc pas le préparer pour un firmware plus ancien.",
  },
  de: {
    noKeys: "Dieser Server hat keine Konsolenschlüssel (prod.keys) und kann dieses Spiel daher nicht für eine ältere Firmware vorbereiten.",
    badTarget: "Die Konsole hat eine Firmware-Schlüsselgeneration gesendet, die der Server nicht versteht.",
    keysTooOld: "Die prod.keys des Servers sind zu alt, um fortzufahren. Ersetze sie durch prod.keys von Firmware {version} oder neuer.",
    keyMissing: "Der prod.keys des Servers fehlt ein Schlüssel der Generation {gen} (Firmware {firmware}), den diese Änderung braucht.",
    unsupported: "Der Server kann diese Datei nicht für eine ältere Firmware vorbereiten: Ihr Aufbau ist keiner, den er ändern kann.",
    personalTicket: "Das Ticket dieses Spiels ist an eine einzelne Konsole gebunden, daher kann der Server es nicht für eine ältere Firmware vorbereiten.",
  },
  it: {
    noKeys: "Questo server non ha le chiavi della console (prod.keys), quindi non può preparare questo gioco per un firmware precedente.",
    badTarget: "La console ha inviato una generazione di chiavi del firmware che il server non riconosce.",
    keysTooOld: "Il prod.keys del server è troppo vecchio per continuare. Sostituiscilo con un prod.keys del firmware {version} o successivo.",
    keyMissing: "Nel prod.keys del server manca una chiave della generazione {gen} (firmware {firmware}) necessaria per questa modifica.",
    unsupported: "Il server non può preparare questo file per un firmware precedente: la sua struttura non è tra quelle che sa modificare.",
    personalTicket: "Il ticket di questo gioco è legato a una sola console, quindi il server non può prepararlo per un firmware precedente.",
  },
  pt: {
    noKeys: "Este servidor não tem as chaves do console (prod.keys), por isso não pode preparar este jogo para um firmware anterior.",
    badTarget: "O console enviou uma geração de chaves de firmware que o servidor não entende.",
    keysTooOld: "O prod.keys do servidor é antigo demais para continuar. Substitua-o por um prod.keys do firmware {version} ou posterior.",
    keyMissing: "Falta no prod.keys do servidor uma chave da geração {gen} (firmware {firmware}) de que esta mudança precisa.",
    unsupported: "O servidor não pode preparar este arquivo para um firmware anterior: a estrutura dele não é uma que ele saiba alterar.",
    personalTicket: "O tíquete deste jogo está vinculado a um único console, por isso o servidor não pode prepará-lo para um firmware anterior.",
  },
  ru: {
    noKeys: "На этом сервере нет ключей консоли (prod.keys), поэтому он не может подготовить эту игру для более старой прошивки.",
    badTarget: "Консоль прислала поколение ключей прошивки, которое сервер не понимает.",
    keysTooOld: "prod.keys на сервере слишком старый, продолжить нельзя. Замените его на prod.keys от прошивки {version} или новее.",
    keyMissing: "В prod.keys сервера нет ключа поколения {gen} (прошивка {firmware}), нужного для этого изменения.",
    unsupported: "Сервер не может подготовить этот файл для более старой прошивки: такую структуру он изменять не умеет.",
    personalTicket: "Билет этой игры привязан к одной консоли, поэтому сервер не может подготовить её для более старой прошивки.",
  },
  nl: {
    noKeys: "Deze server heeft geen consolesleutels (prod.keys) en kan dit spel daarom niet voorbereiden voor een oudere firmware.",
    badTarget: "De console stuurde een generatie firmwaresleutels die de server niet begrijpt.",
    keysTooOld: "De prod.keys van de server is te oud om verder te gaan. Vervang hem door prod.keys van firmware {version} of nieuwer.",
    keyMissing: "In de prod.keys van de server ontbreekt een sleutel van generatie {gen} (firmware {firmware}) die deze wijziging nodig heeft.",
    unsupported: "De server kan dit bestand niet voorbereiden voor een oudere firmware: de opbouw is er geen die hij kan wijzigen.",
    personalTicket: "Het ticket van dit spel is aan één console gebonden, dus de server kan het niet voorbereiden voor een oudere firmware.",
  },
};

const fill = (text, vars) => text.replace(/\{(\w+)\}/g, (m, name) => (vars[name] === undefined ? m : String(vars[name])));

/** The text of `code` ("rewrap.keysTooOld") in `lang`, English when that language lacks it. Pure. */
export function refusalText(code, vars = {}, lang = "en") {
  const key = code.replace(/^rewrap\./, "");
  const text = REWRAP_WORDS[lang]?.[key] ?? REWRAP_WORDS.en[key] ?? REWRAP_WORDS.en.unsupported;
  return fill(text, vars);
}

/** A refused rewrap: English message, `code` and `vars` for the reader's language, `detail` for the log. */
export class RewrapError extends Error {
  constructor(key, vars = {}, detail = null) {
    const code = `rewrap.${key}`;
    super(refusalText(code, vars));
    this.code = code;
    this.vars = vars;
    this.detail = detail;
  }
}

/**
 * The 409 body for a refusal: `error` in the request's language (what a client that predates `errors`
 * reads), `errors` in every language, and `code`. The same shape as every variant refusal.
 */
export const refusalBody = (req, err) => ({
  error: refusalText(err.code, err.vars, requestLang(req)),
  errors: Object.fromEntries(LANGS.map((lang) => [lang, refusalText(err.code, err.vars, lang)])),
  code: err.code,
});
