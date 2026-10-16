/**
 * This is a personal server: nothing on it is for search engines or AI training.
 *
 * robots.txt already says so (index.js) and every response carries X-Robots-Tag
 * (headers.js). This turns away the crawlers that announce themselves, before
 * the sign-in page, so they do not even collect that. Link previews in
 * messengers (KakaoTalk, Telegram, Slack, Discord, X, Facebook's link fetcher)
 * are left alone: they are how a link is shared with a friend. Generic HTTP
 * libraries are left alone too: the operator's own scripts use them.
 */

// Search engines, SEO crawlers, and AI training and answer crawlers, by their published names.
export const CRAWLER_RE = new RegExp(
  "\\b(?:" + [
    "googlebot", "google-extended", "googleother", "google-cloudvertexbot", "storebot-google",
    "bingbot", "bingpreview", "msnbot", "yandex(?:bot|images)?", "baiduspider", "duckduckbot", "sogou", "seznambot", "naverbot", "yeti", "daumoa",
    "applebot(?:-extended)?", "amazonbot", "gptbot", "chatgpt-user", "oai-searchbot", "claudebot", "claude-web", "claude-searchbot", "anthropic-ai",
    "ccbot", "bytespider", "perplexitybot", "perplexity-user", "meta-externalagent", "meta-externalfetcher", "facebookbot", "diffbot",
    "imagesiftbot", "cohere-ai", "cohere-training-data-crawler", "youbot", "ai2bot", "petalbot", "mistralai-user", "duckassistbot",
    "ahrefsbot", "semrushbot", "mj12bot", "dotbot", "dataforseobot", "blexbot", "seekportbot", "timpibot", "omgili(?:bot)?", "barkrowler", "serpstatbot",
  ].join("|") + ")\\b",
  "i",
);

export const isCrawler = (ua) => CRAWLER_RE.test(String(ua ?? ""));

export default function noCrawl() {
  return (req, res, next) => {
    if (!isCrawler(req.get("user-agent"))) return next();
    res.set("Cache-Control", "no-store").status(403).type("text/plain").send("This is a personal server. Crawling is not allowed.\n");
  };
}
