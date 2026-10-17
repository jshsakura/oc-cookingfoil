/**
 * The link-preview card (Open Graph / Twitter) for pages a shared link can land
 * on without signing in. A shared server address redirects to /login, so the
 * card has to be there as well as on the landing page (landing.html, same text).
 */
export const SHARE_TITLE = "CookingFoil";
export const SHARE_DESCRIPTION = "개인을 위한 비공개 라이브러리 관리자입니다.";
const SAFE_ORIGIN = /^https?:\/\/[A-Za-z0-9.\-[\]:]+(\/[A-Za-z0-9._~%/-]*)?$/;

/** The card's meta tags; the image URL is absolute when `origin` is a plain origin, relative otherwise. Pure. */
export function shareTags(origin) {
  const image = `${SAFE_ORIGIN.test(origin ?? "") ? origin : ""}/assets/og-image.png`;
  return [
    `<meta name="description" content="${SHARE_DESCRIPTION}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="${SHARE_TITLE}">`,
    `<meta property="og:title" content="${SHARE_TITLE}">`,
    `<meta property="og:description" content="${SHARE_DESCRIPTION}">`,
    `<meta property="og:image" content="${image}">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta property="og:image:alt" content="cookingfoil.">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${SHARE_TITLE}">`,
    `<meta name="twitter:description" content="${SHARE_DESCRIPTION}">`,
    `<meta name="twitter:image" content="${image}">`,
  ].join("");
}
