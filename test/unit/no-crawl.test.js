import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import noCrawl, { isCrawler } from "../../src/security/no-crawl.js";
import defensiveHeaders from "../../src/security/headers.js";

// A personal server: crawlers that name themselves are turned away, link
// previews and the operator's own scripts and consoles are not.

test("search, SEO and AI crawlers are recognised by their published names", () => {
  for (const ua of [
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)",
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
    "CCBot/2.0 (https://commoncrawl.org/faq/)",
    "Mozilla/5.0 (Linux; Android 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Mobile Safari/537.36 (compatible; Bytespider; spider-feedback@bytedance.com)",
    "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
    "Mozilla/5.0 (compatible; Yeti/1.1; +https://naver.me/spd)",
    "meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)",
    "Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)",
  ]) assert.ok(isCrawler(ua), ua);
});

test("browsers, consoles, scripts and messenger link previews are let through", () => {
  for (const ua of [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
    "CookingFoil/0.3.72", "OtherClient/1.4.5", "AnotherClient/18.0", "curl/8.5.0", "python-requests/2.32.3", "Go-http-client/2.0",
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)", "TelegramBot (like TwitterBot)",
    "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)", "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
    "Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/43.0.2357.130 Safari/537.36 kakaotalk-scrap/1.0",
    "", null,
  ]) assert.ok(!isCrawler(ua), String(ua));
});

test("a crawler gets 403 and nothing else; every response says noindex", async () => {
  const app = express();
  app.use(defensiveHeaders());
  app.use(noCrawl());
  app.get("/login", (_req, res) => res.send("sign in"));
  const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const bot = await fetch(`${base}/login`, { headers: { "User-Agent": "GPTBot/1.2" } });
    assert.equal(bot.status, 403);
    assert.doesNotMatch(await bot.text(), /sign in/);
    const person = await fetch(`${base}/login`, { headers: { "User-Agent": "Mozilla/5.0 Safari/605.1.15" } });
    assert.equal(person.status, 200);
    assert.match(person.headers.get("x-robots-tag"), /noindex.*nofollow.*noai/);
    assert.match(bot.headers.get("x-robots-tag"), /noindex/);
  } finally {
    server.close();
  }
});
