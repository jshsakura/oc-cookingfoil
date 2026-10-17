/**
 * The link-preview card (Open Graph / Twitter) for pages a shared link can land
 * on without signing in. A shared server address redirects to /login, so the
 * card has to be there as well as on the landing page (landing.html).
 *
 * The card is in the visitor's language (meta/categories.js requestLang; a
 * preview fetcher that names none gets English). Each image carries only its
 * own tagline; they are drawn by ~/app/cookingfoil-ops/og-image.mjs from the
 * same lines as SHARE_TAGLINES below.
 */
export const SHARE_TITLE = "CookingFoil";
export const SHARE_LANGS = ["en", "ko", "ja", "zh"];
export const SHARE_TAGLINES = {
  en: "A private library manager, just for you.",
  ko: "개인을 위한 비공개 라이브러리 관리자입니다.",
  ja: "あなただけの非公開ライブラリマネージャーです。",
  zh: "专属于你的私人资料库管理器。",
};
const SAFE_ORIGIN = /^https?:\/\/[A-Za-z0-9.\-[\]:]+(\/[A-Za-z0-9._~%/-]*)?$/;

/** The image path for a language: English is the plain og-image.png. Pure. */
export const shareImagePath = (lang) => (lang !== "en" && SHARE_LANGS.includes(lang) ? `/assets/og-image-${lang}.png` : "/assets/og-image.png");

/** The card's meta tags; the image URL is absolute when `origin` is a plain origin, relative otherwise. Pure. */
export function shareTags(origin, lang = "en") {
  const l = SHARE_LANGS.includes(lang) ? lang : "en";
  const image = `${SAFE_ORIGIN.test(origin ?? "") ? origin : ""}${shareImagePath(l)}`;
  const description = SHARE_TAGLINES[l];
  return [
    `<meta name="description" content="${description}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="${SHARE_TITLE}">`,
    `<meta property="og:title" content="${SHARE_TITLE}">`,
    `<meta property="og:description" content="${description}">`,
    `<meta property="og:locale" content="${{ en: "en_US", ko: "ko_KR", ja: "ja_JP", zh: "zh_CN" }[l]}">`,
    `<meta property="og:image" content="${image}">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta property="og:image:alt" content="cookingfoil.">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${SHARE_TITLE}">`,
    `<meta name="twitter:description" content="${description}">`,
    `<meta name="twitter:image" content="${image}">`,
  ].join("");
}
