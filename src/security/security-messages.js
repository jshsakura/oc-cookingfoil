/**
 * What the security modules say when they refuse a setting or a sign-in, in the four admin languages:
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
};

const wordsFor = (lang) => SECURITY_MESSAGES[lang] ?? (lang === "zh-Hant" ? SECURITY_MESSAGES.zh : SECURITY_MESSAGES.en);

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
