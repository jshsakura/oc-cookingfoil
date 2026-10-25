/**
 * What the security modules say when they refuse a setting or a sign-in, in the twelve admin languages:
 * outbound addresses (outbound-guard.js), Google sign-in settings (google-config.js), service keys
 * (integrations.js), automation tokens (api-tokens.js) and the code lockout (totp-guard.js).
 *
 * An error carries its message in English, the key here as `code` and the placeholder values as `vars`
 * (codedError). A route answers in the request's language by that code (securityError), so the admin page,
 * which sends Accept-Language, reads its own language and a token or script reads English.
 * {name} placeholders are filled by securityText.
 */
import { requestLang } from "../meta/langs.js";

export const SECURITY_MESSAGES = {
  ko: {
    "outbound.invalid": "http:// 또는 https:// 로 시작하는 주소만 쓸 수 있습니다.",
    "outbound.unresolved": "주소의 호스트 이름을 찾지 못했습니다. 주소를 확인합니다.",
    "outbound.blocked": "이 주소는 내부망(사설, 루프백, 링크 로컬, CGNAT, 클라우드 메타데이터 주소)을 가리켜서 쓸 수 없습니다. 인터넷에 공개된 주소만 쓸 수 있습니다.",
    "outbound.redirects": "주소가 너무 여러 번 다른 곳으로 넘겨서 따라가지 않았습니다.",
    "google.badId": "클라이언트 ID 형식이 아닙니다",
    "google.badSecret": "클라이언트 시크릿 형식이 아닙니다",
    "google.needBoth": "켜려면 클라이언트 ID 와 시크릿이 모두 필요합니다",
    "integration.unknown": "알 수 없는 서비스입니다",
    "integration.badField": "{field} 형식이 맞지 않습니다",
    "token.max": "토큰은 {n}개까지 만들 수 있습니다",
    "token.missing": "없는 토큰입니다",
    "totp.locked": "인증 코드를 너무 여러 번 틀려 잠갔습니다. 15분 뒤에 다시 시도합니다.",
  },
  en: {
    "outbound.invalid": "Only addresses starting with http:// or https:// can be used.",
    "outbound.unresolved": "The address's host name could not be found. Check the address.",
    "outbound.blocked": "This address points into a private network (private, loopback, link-local, CGNAT or cloud metadata addresses) and cannot be used. Only public internet addresses can be used.",
    "outbound.redirects": "The address redirected too many times, so it was not followed.",
    "google.badId": "That is not a client ID",
    "google.badSecret": "That is not a client secret",
    "google.needBoth": "Turning it on needs both the client ID and the secret",
    "integration.unknown": "Unknown service",
    "integration.badField": "{field} is not in the right format",
    "token.max": "Up to {n} tokens can be made",
    "token.missing": "No such token",
    "totp.locked": "Too many wrong codes, so sign-in by code is locked. Try again in 15 minutes.",
  },
  ja: {
    "outbound.invalid": "http:// または https:// で始まるアドレスだけ使えます。",
    "outbound.unresolved": "アドレスのホスト名が見つかりませんでした。アドレスを確認します。",
    "outbound.blocked": "このアドレスは内部ネットワーク(プライベート、ループバック、リンクローカル、CGNAT、クラウドのメタデータアドレス)を指すため使えません。インターネットに公開されたアドレスだけ使えます。",
    "outbound.redirects": "アドレスが何度も別の場所へ転送したため、たどりませんでした。",
    "google.badId": "クライアント ID の形式ではありません",
    "google.badSecret": "クライアントシークレットの形式ではありません",
    "google.needBoth": "オンにするにはクライアント ID とシークレットの両方が必要です",
    "integration.unknown": "不明なサービスです",
    "integration.badField": "{field} の形式が正しくありません",
    "token.max": "トークンは {n} 個まで作れます",
    "token.missing": "存在しないトークンです",
    "totp.locked": "認証コードを何度も間違えたためロックしました。15 分後にもう一度試します。",
  },
  zh: {
    "outbound.invalid": "只能使用以 http:// 或 https:// 开头的地址。",
    "outbound.unresolved": "找不到地址的主机名。请检查地址。",
    "outbound.blocked": "此地址指向内部网络(私有、回环、链路本地、CGNAT、云元数据地址)，不能使用。只能使用公开的互联网地址。",
    "outbound.redirects": "地址重定向次数过多，未继续跟随。",
    "google.badId": "不是客户端 ID 格式",
    "google.badSecret": "不是客户端密钥格式",
    "google.needBoth": "开启需要同时填写客户端 ID 和密钥",
    "integration.unknown": "未知的服务",
    "integration.badField": "{field} 格式不正确",
    "token.max": "最多可以创建 {n} 个令牌",
    "token.missing": "没有这个令牌",
    "totp.locked": "验证码错误次数过多，已锁定。请 15 分钟后再试。",
  },
  "zh-Hant": {
      "outbound.invalid": "只能使用以 http:// 或 https:// 開頭的網址。",
      "outbound.unresolved": "找不到網址的主機名稱。請檢查網址。",
      "outbound.blocked": "此網址指向內部網路（私人、回送、連結本機、CGNAT 或雲端中繼資料位址），無法使用。只能使用公開的網際網路位址。",
      "outbound.redirects": "網址重新導向次數過多，已停止跟隨。",
      "google.badId": "用戶端 ID 格式不正確",
      "google.badSecret": "用戶端密鑰格式不正確",
      "google.needBoth": "啟用時必須同時填寫用戶端 ID 和密鑰",
      "integration.unknown": "未知的服務",
      "integration.badField": "{field} 格式不正確",
      "token.max": "最多可以建立 {n} 個權杖",
      "token.missing": "找不到此權杖",
      "totp.locked": "驗證碼錯誤次數過多，已鎖定。請在 15 分鐘後再試。"
  },
  "es": {
      "outbound.invalid": "Solo se permiten direcciones que empiecen por http:// o https://.",
      "outbound.unresolved": "No se encuentra el nombre del servidor de la dirección. Comprueba la dirección.",
      "outbound.blocked": "Esta dirección apunta a una red interna (privada, de bucle local, de enlace local, CGNAT o metadatos de la nube) y no se puede usar. Solo se permiten direcciones públicas de Internet.",
      "outbound.redirects": "La dirección ha redirigido demasiadas veces; no se han seguido más redirecciones.",
      "google.badId": "El ID de cliente no tiene un formato válido",
      "google.badSecret": "El secreto de cliente no tiene un formato válido",
      "google.needBoth": "Para activarlo se necesitan el ID y el secreto de cliente",
      "integration.unknown": "Servicio desconocido",
      "integration.badField": "El formato de {field} no es válido",
      "token.max": "Se pueden crear hasta {n} tokens",
      "token.missing": "No existe ese token",
      "totp.locked": "Demasiados códigos de verificación incorrectos. Acceso bloqueado; vuelve a intentarlo en 15 minutos."
  },
  "fr": {
      "outbound.invalid": "Seules les adresses commençant par http:// ou https:// sont autorisées.",
      "outbound.unresolved": "Le nom du serveur de cette adresse est introuvable. Vérifiez l’adresse.",
      "outbound.blocked": "Cette adresse pointe vers un réseau interne (privé, boucle locale, lien local, CGNAT ou métadonnées cloud) et ne peut pas être utilisée. Seules les adresses publiques sur Internet sont autorisées.",
      "outbound.redirects": "L’adresse a effectué trop de redirections ; les suivantes n’ont pas été suivies.",
      "google.badId": "Le format de l’identifiant client est incorrect",
      "google.badSecret": "Le format du secret client est incorrect",
      "google.needBoth": "L’identifiant et le secret client sont nécessaires pour l’activation",
      "integration.unknown": "Service inconnu",
      "integration.badField": "Le format de {field} est incorrect",
      "token.max": "Vous pouvez créer jusqu’à {n} jetons",
      "token.missing": "Ce jeton n’existe pas",
      "totp.locked": "Trop de codes de vérification incorrects. Accès bloqué ; réessayez dans 15 minutes."
  },
  "de": {
      "outbound.invalid": "Nur Adressen mit http:// oder https:// sind erlaubt.",
      "outbound.unresolved": "Der Hostname dieser Adresse wurde nicht gefunden. Prüfen Sie die Adresse.",
      "outbound.blocked": "Diese Adresse verweist auf ein internes Netz (privat, Loopback, Link-Local, CGNAT oder Cloud-Metadaten) und kann nicht verwendet werden. Nur öffentliche Internetadressen sind erlaubt.",
      "outbound.redirects": "Die Adresse wurde zu oft weitergeleitet; weiteren Umleitungen wurde nicht gefolgt.",
      "google.badId": "Die Client-ID hat ein ungültiges Format",
      "google.badSecret": "Das Client-Geheimnis hat ein ungültiges Format",
      "google.needBoth": "Zum Aktivieren sind Client-ID und Client-Geheimnis erforderlich",
      "integration.unknown": "Unbekannter Dienst",
      "integration.badField": "Das Format von {field} ist ungültig",
      "token.max": "Es können höchstens {n} Tokens erstellt werden",
      "token.missing": "Dieses Token existiert nicht",
      "totp.locked": "Zu viele falsche Bestätigungscodes. Der Zugriff ist gesperrt; versuchen Sie es in 15 Minuten erneut."
  },
  "it": {
      "outbound.invalid": "Sono ammessi solo indirizzi che iniziano con http:// o https://.",
      "outbound.unresolved": "Il nome host dell’indirizzo non è stato trovato. Controlla l’indirizzo.",
      "outbound.blocked": "Questo indirizzo punta a una rete interna (privata, loopback, collegamento locale, CGNAT o metadati cloud) e non può essere usato. Sono ammessi solo indirizzi Internet pubblici.",
      "outbound.redirects": "L’indirizzo ha effettuato troppi reindirizzamenti; gli altri non sono stati seguiti.",
      "google.badId": "Il formato dell’ID client non è valido",
      "google.badSecret": "Il formato del segreto client non è valido",
      "google.needBoth": "Per attivare sono necessari sia l’ID sia il segreto client",
      "integration.unknown": "Servizio sconosciuto",
      "integration.badField": "Il formato di {field} non è valido",
      "token.max": "Puoi creare al massimo {n} token",
      "token.missing": "Questo token non esiste",
      "totp.locked": "Troppi codici di verifica errati. Accesso bloccato; riprova tra 15 minuti."
  },
  "pt": {
      "outbound.invalid": "Só são permitidos endereços que comecem com http:// ou https://.",
      "outbound.unresolved": "O nome do servidor desse endereço não foi encontrado. Verifique o endereço.",
      "outbound.blocked": "Esse endereço aponta para uma rede interna (privada, loopback, link local, CGNAT ou metadados da nuvem) e não pode ser usado. Só são permitidos endereços públicos da Internet.",
      "outbound.redirects": "O endereço fez redirecionamentos demais; os seguintes não foram seguidos.",
      "google.badId": "O formato do ID do cliente é inválido",
      "google.badSecret": "O formato do segredo do cliente é inválido",
      "google.needBoth": "Para ativar, são necessários o ID e o segredo do cliente",
      "integration.unknown": "Serviço desconhecido",
      "integration.badField": "O formato de {field} é inválido",
      "token.max": "É possível criar até {n} tokens",
      "token.missing": "Esse token não existe",
      "totp.locked": "Muitos códigos de verificação incorretos. Acesso bloqueado; tente novamente em 15 minutos."
  },
  "nl": {
      "outbound.invalid": "Alleen adressen die met http:// of https:// beginnen zijn toegestaan.",
      "outbound.unresolved": "De hostnaam van dit adres is niet gevonden. Controleer het adres.",
      "outbound.blocked": "Dit adres verwijst naar een intern netwerk (privé, loopback, link-local, CGNAT of cloudmetadata) en kan niet worden gebruikt. Alleen openbare internetadressen zijn toegestaan.",
      "outbound.redirects": "Het adres is te vaak doorgestuurd; verdere omleidingen zijn niet gevolgd.",
      "google.badId": "De client-ID heeft een ongeldige indeling",
      "google.badSecret": "Het clientgeheim heeft een ongeldige indeling",
      "google.needBoth": "Zowel de client-ID als het clientgeheim is nodig om dit in te schakelen",
      "integration.unknown": "Onbekende dienst",
      "integration.badField": "De indeling van {field} is ongeldig",
      "token.max": "Er kunnen maximaal {n} tokens worden gemaakt",
      "token.missing": "Dit token bestaat niet",
      "totp.locked": "Te veel onjuiste verificatiecodes. De toegang is geblokkeerd; probeer het over 15 minuten opnieuw."
  },
  "ru": {
      "outbound.invalid": "Разрешены только адреса, начинающиеся с http:// или https://.",
      "outbound.unresolved": "Не удалось найти имя узла для этого адреса. Проверьте адрес.",
      "outbound.blocked": "Этот адрес ведёт во внутреннюю сеть (частную, петлевую, локальную для канала, CGNAT или к метаданным облака) и не может использоваться. Разрешены только публичные адреса Интернета.",
      "outbound.redirects": "Адрес выполнил слишком много перенаправлений; дальнейшие переходы остановлены.",
      "google.badId": "Неверный формат идентификатора клиента",
      "google.badSecret": "Неверный формат секрета клиента",
      "google.needBoth": "Для включения нужны идентификатор и секрет клиента",
      "integration.unknown": "Неизвестный сервис",
      "integration.badField": "Неверный формат поля {field}",
      "token.max": "Максимальное число токенов: {n}",
      "token.missing": "Такого токена нет",
      "totp.locked": "Слишком много неверных кодов подтверждения. Доступ заблокирован; повторите попытку через 15 минут."
  },

};

const wordsFor = (lang) => SECURITY_MESSAGES[lang] ?? SECURITY_MESSAGES.en;

/** The message `key` in `lang` (English when it is not an admin language), placeholders filled. Pure. */
export function securityText(lang, key, vars = {}) {
  const text = wordsFor(lang)[key] ?? SECURITY_MESSAGES.en[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (m, name) => (vars[name] === undefined ? m : String(vars[name])));
}

/** Whether `code` names a message here. Pure. */
export const isSecurityCode = (code) => typeof code === "string" && Object.hasOwn(SECURITY_MESSAGES.en, code);

/** An instance of `ErrorClass` saying message `code`: English message, `code` and `vars` on it. */
export const codedError = (ErrorClass, code, vars = {}) => Object.assign(new ErrorClass(securityText("en", code, vars)), { code, vars });

/** A route's JSON error: the text in the request's language, and its code when it has one. */
export const securityError = (req, err) => (isSecurityCode(err?.code)
  ? { error: securityText(requestLang(req), err.code, err.vars), code: err.code }
  : { error: String(err?.message ?? err) });
