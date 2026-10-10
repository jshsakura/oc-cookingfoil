#!/usr/bin/env node
/* global document, localStorage -- used inside page.evaluate / addInitScript, which run in the browser */
/**
 * Regenerates the README screenshots in docs/screenshots/ from made-up games.
 *
 * Starts the web test server (test/web/server.mjs) and, in the browser, swaps
 * the catalog endpoints for a fictional library with generated placeholder
 * art, so no real game names or Nintendo artwork ever end up in the repo.
 *
 *   node scripts/readme-screenshots.mjs
 *   PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chrome node scripts/readme-screenshots.mjs
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { GENRE_LABELS } from "../src/meta/categories.js";
import { SCORE_LABELS } from "../src/meta/scraper-ratings.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "docs/screenshots");
const PORT = 3199;
const BASE = `http://127.0.0.1:${PORT}`;

// [en, ko, ja, publisher, genres, score, players, size GB, price, sale]
const GAMES = [
  ["Butter Knight", "버터 나이트", "バターナイト", "Toastworks", ["Action", "Adventure"], 94, 1, 6.2, "$24.99", "$12.49"],
  ["Skyline Couriers", "스카이라인 택배", "スカイライン便", "Paper Plane Co.", ["Simulation", "Party"], 88, 4, 2.1, "$19.99", null],
  ["Moss & Lantern", "이끼와 등불", "苔とランタン", "Quiet Pond", ["Adventure", "Puzzle"], 91, 1, 3.4, "$14.99", null],
  ["Pixel Harvest", "픽셀 수확", "ピクセル収穫", "Fieldnotes", ["Simulation"], 86, 2, 1.2, "$17.99", "$8.99"],
  ["Neon Drift 2", "네온 드리프트 2", "ネオンドリフト2", "Lightbend", ["Racing", "Arcade"], 79, 4, 9.8, "$29.99", null],
  ["Tiny Tavern", "작은 선술집", "ちいさな酒場", "Hearthside", ["Simulation", "Strategy"], 83, 1, 0.9, "$12.99", null],
  ["Comet Cooks", "혜성 요리사", "コメットクック", "Toastworks", ["Party", "Arcade"], 72, 4, 2.6, "$24.99", "$16.24"],
  ["Orbit Orchard", "궤도 과수원", "軌道の果樹園", "Fieldnotes", ["Simulation", "Puzzle"], 68, 1, 0.7, "$9.99", null],
  ["Paper Galleon", "종이 범선", "紙のガレオン", "Paper Plane Co.", ["Adventure", "RPG"], 90, 1, 12.4, "$39.99", null],
  ["Quiet Lighthouse", "고요한 등대", "静かな灯台", "Quiet Pond", ["Adventure"], 77, 1, 1.8, "$14.99", null],
  ["Foxfire Trails", "여우불 길", "狐火の道", "Lightbend", ["RPG", "Action"], 85, 1, 14.1, "$49.99", "$29.99"],
  ["Brass Golem Arena", "황동 골렘 투기장", "真鍮ゴーレム闘技場", "Gearbox Garden", ["Fighting", "Action"], 74, 4, 5.5, "$29.99", null],
  ["Tidepool Detectives", "조수 웅덩이 탐정단", "潮だまり探偵団", "Quiet Pond", ["Puzzle", "Adventure"], 89, 2, 2.3, "$19.99", null],
  ["Snowglobe Rally", "스노우볼 랠리", "スノードームラリー", "Lightbend", ["Racing", "Party"], 81, 4, 4.0, "$34.99", "$17.49"],
  ["Clockwork Kitchen", "태엽 주방", "ぜんまいキッチン", "Gearbox Garden", ["Party", "Simulation"], 87, 4, 3.1, "$24.99", null],
  ["Lantern Fest", "등불 축제", "ランタン祭り", "Hearthside", ["Party", "Music"], 66, 8, 1.4, "$14.99", null],
  ["Starlit Fishing", "별빛 낚시", "星明かりの釣り", "Fieldnotes", ["Sports", "Simulation"], 82, 2, 2.0, "$19.99", null],
  ["Garden Gnome Tactics", "정원 요정 전술", "庭小人タクティクス", "Gearbox Garden", ["Strategy", "RPG"], 93, 1, 7.7, "$34.99", null],
  ["Velvet Racers", "벨벳 레이서", "ベルベットレーサー", "Lightbend", ["Racing"], 58, 2, 6.9, "$29.99", "$9.99"],
  ["Hollow Bell", "텅 빈 종", "うつろな鐘", "Quiet Pond", ["Action", "Platformer"], 96, 1, 8.3, "$24.99", null],
  ["Cosmic Curling", "우주 컬링", "宇宙カーリング", "Toastworks", ["Sports", "Party"], 70, 4, 1.1, "$14.99", null],
  ["Ember Forge", "불씨 대장간", "残り火の鍛冶場", "Hearthside", ["Strategy", "Simulation"], 84, 1, 3.9, "$24.99", null],
  ["Puddle Jumpers", "물웅덩이 점퍼", "水たまりジャンパーズ", "Paper Plane Co.", ["Platformer", "Party"], 78, 4, 2.8, "$19.99", null],
  ["Mapmaker's Guild", "지도 제작자 길드", "地図職人ギルド", "Fieldnotes", ["Strategy", "Adventure"], 88, 1, 4.6, "$29.99", null],
];

const DAY = 86_400;
const NOW = Math.floor(Date.UTC(2026, 9, 1) / 1000);
const idOf = (i) => (0x0500000000000000n + BigInt(i + 1) * 0x2000n).toString(16).toUpperCase().padStart(16, "0");
const steamLabel = (s) => (s >= 95 ? "Overwhelmingly Positive" : s >= 85 ? "Very Positive" : s >= 80 ? "Mostly Positive" : s >= 70 ? "Mostly Positive" : s >= 40 ? "Mixed" : "Mostly Negative");
const initials = (name) => name.replace(/[^A-Za-z0-9 ]/g, "").split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
const hueOf = (i) => (i * 47) % 360;

const games = GAMES.map(([en, ko, ja, publisher, genres, score, players, gb, regular, discount], i) => {
  const id = idOf(i);
  const release = 20250101 + Math.floor(i / 2) * 100 + (i % 2) * 14;
  return { i, id, en, ko, ja, publisher, genres, score, players, size: Math.round(gb * 2 ** 30), regular, discount, release, added: NOW - i * 2 * DAY };
});

function placeholder(g, w, h, label) {
  const hue = hueOf(g.i);
  const unit = Math.min(w, h);
  const bw = unit * 0.5, bh = bw * 0.48, bx = (w - bw) / 2, by = h * 0.24;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs><pattern id="p" width="28" height="28" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
<rect width="28" height="28" fill="hsl(${hue},38%,86%)"/><rect width="12" height="28" fill="hsl(${hue},34%,80%)"/></pattern></defs>
<rect width="100%" height="100%" fill="url(#p)"/>
<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="${bh * 0.25}" fill="#FFC23D" stroke="#16161A" stroke-width="${unit * 0.02}"/>
<rect x="${bx}" y="${by}" width="${bw}" height="${bh * 0.35}" rx="${bh * 0.17}" fill="#FFE08A"/>
<text x="50%" y="${h * 0.82}" text-anchor="middle" font-family="Arial, sans-serif" font-weight="800" font-size="${Math.min(unit * 0.2, (w * 1.5) / label.length)}" fill="#16161A">${label}</text></svg>`;
}

function catalog() {
  const files = [];
  const titledb = {};
  for (const g of games) {
    files.push({ url: `../${g.en} [${g.id}][v0].nsp`, size: g.size, name: g.en, titleId: g.id, baseTitleId: g.id, kind: "base", mtime: g.added, icon_url: `/api/shop/icon/${g.id}` });
    if (g.i % 3 === 0) {
      const upd = g.id.slice(0, 13) + "800";
      files.push({ url: `../${g.en} [${upd}][v65536].nsp`, size: 300 << 20, name: g.en, titleId: upd, baseTitleId: g.id, kind: "update", mtime: g.added + DAY, icon_url: `/api/shop/icon/${upd}` });
    }
    if (g.i % 5 === 0) {
      const dlc = g.id.slice(0, 12) + "1001";
      files.push({ url: `../${g.en} Extra [${dlc}][v0].nsp`, size: 120 << 20, name: `${g.en}: Extra`, titleId: dlc, baseTitleId: g.id, kind: "dlc", mtime: g.added + 2 * DAY, icon_url: `/api/shop/icon/${dlc}` });
    }
    titledb[g.id] = { name: g.en, publisher: g.publisher, releaseDate: g.release, aliases: [g.en, g.ko, g.ja] };
  }
  const items = games.map((g) => ({
    app_type: "base", title_id: g.id, name: g.en, names: { en: g.en, ko: g.ko, ja: g.ja },
    categories: g.genres, players: g.players, release_date: g.release, added_at: g.added, rank: g.i + 1,
    languages: ["en", "ko", "ja"], score: g.score, score_count: 800 + g.i * 137, score_source: "steam", score_label: steamLabel(g.score),
    icon_url: `/api/shop/icon/${g.id}`, price_regular: g.regular, price_country: "US",
    ...(g.discount ? { price_discount: g.discount, price_discount_ends: "2026-12-31T23:59:59Z" } : {}),
  }));
  return {
    shop: { success: "Welcome to the demo shop", files, titledb },
    sections: { sections: [{ id: "all", title: "All", items }], genres: GENRE_LABELS, score_labels: SCORE_LABELS, featured: [] },
  };
}

function detail(g, lang) {
  const name = { en: g.en, ko: g.ko, ja: g.ja }[lang] ?? g.en;
  return {
    id: g.id, name, publisher: g.publisher, names: { en: g.en, ko: g.ko, ja: g.ja },
    description: `${g.en} is a made-up game used for these screenshots. It shows how a title's description, facts, screenshots and review score appear in the dashboard.`,
    categories: g.genres, categoryLabels: g.genres.map((k) => GENRE_LABELS[k]?.[lang] ?? k), category: g.genres.join(", "),
    releaseDate: g.release, region: "US", rating: "E", numberOfPlayers: g.players, size: g.size,
    iconUrl: `/api/shop/icon/${g.id}`, bannerUrl: `/api/shop/banner/${g.id}`,
    screenshots: [0, 1, 2].map((n) => `/api/shop/screenshot/${g.id}/${n}`), screenshotCount: 3,
    score: g.score, scoreCount: 800 + g.i * 137, scoreSource: "steam",
    scoreLabel: SCORE_LABELS[steamLabel(g.score)]?.[lang] ?? steamLabel(g.score), scoreLabelKey: steamLabel(g.score),
  };
}

async function startServer() {
  const env = {
    ...process.env, COOK_PORT: String(PORT), COOK_DATA_DIR: "/tmp/cookingfoil-readme-data", COOK_GAMES_DIR: "/tmp/cookingfoil-readme-games",
    COOK_TITLEDB_AUTO_FETCH: "false", COOK_EXTRACT_ICONS: "off", COOK_AUTH_USERS: "", COOK_ESHOP_PRICES: "false",
    COOK_ESHOP_POPULARITY: "false", COOK_ESHOP_ARTWORK: "false", COOK_RATING_SYNC: "false",
  };
  const child = spawn(process.execPath, ["test/web/server.mjs"], { cwd: ROOT, env, stdio: "ignore" });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${BASE}/healthz`)).ok) return child; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  child.kill();
  throw new Error("server did not start");
}

async function mockCatalog(page) {
  const { shop, sections } = catalog();
  const byId = new Map(games.map((g) => [g.id, g]));
  const gameFor = (id) => byId.get(id) ?? byId.get(id.slice(0, 13) + "000") ?? games[0];
  const svg = (body) => ({ body, contentType: "image/svg+xml" });
  await page.route("**/shop.json", (r) => r.fulfill({ json: shop }));
  await page.route("**/api/shop/sections", (r) => r.fulfill({ json: sections }));
  await page.route("**/healthz", (r) => r.fulfill({ json: {
    ok: true, files: shop.files.length,
    titledb: { titles: 44698, regions: [{ region: "US.en", count: 29572 }, { region: "KR.ko", count: 16840 }, { region: "JP.ja", count: 27231 }] },
    nameHealth: { titledb: { titles: 44698, regions: ["US.en", "KR.ko", "JP.ja"] }, extraction: { mode: "missing", nstool: true, prodKeys: true, nspXciCapable: true, nroCapable: true }, verdict: "ok" },
  } }));
  await page.route("**/api/connect-url", (r) => r.fulfill({ json: { url: "https://shop.example.com/" } }));
  await page.route("**/api/art/*", (r) => r.fulfill({ json: { icon: false, banner: false, screens: [] } }));
  await page.route(/\/api\/title\/[0-9A-F]{16}(\?|$)/, (r) => {
    const url = new URL(r.request().url());
    r.fulfill({ json: detail(gameFor(url.pathname.split("/").pop()), url.searchParams.get("lang") || "en") });
  });
  await page.route("**/api/shop/icon/*", (r) => {
    const g = gameFor(new URL(r.request().url()).pathname.split("/").pop());
    r.fulfill(svg(placeholder(g, 512, 512, initials(g.en))));
  });
  await page.route("**/api/shop/banner/*", (r) => {
    const g = gameFor(new URL(r.request().url()).pathname.split("/").pop());
    r.fulfill(svg(placeholder(g, 1280, 720, g.en.toUpperCase())));
  });
  await page.route("**/api/shop/screenshot/**", (r) => {
    const g = gameFor(new URL(r.request().url()).pathname.split("/")[4]);
    r.fulfill(svg(placeholder(g, 1280, 720, initials(g.en))));
  });
}

async function shot(browser, { file, width, height, scheme, lang = "en", hash = "", prepare }) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, locale: lang });
  await ctx.addInitScript((l) => { try { localStorage.setItem("cookingfoil:lang", l); } catch { /* private */ } }, lang);
  const page = await ctx.newPage();
  await mockCatalog(page);
  await page.goto(`${BASE}/${hash}`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(800);
  if (prepare) await prepare(page);
  await page.screenshot({ path: path.join(OUT, file) });
  await ctx.close();
  console.log("wrote", path.relative(ROOT, path.join(OUT, file)));
}

const server = await startServer();
try {
  fs.mkdirSync(OUT, { recursive: true });
  const exe = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  await shot(browser, { file: "preview-dark.png", width: 1440, height: 1000, scheme: "dark", hash: "#preview" });
  await shot(browser, { file: "games-light.png", width: 1440, height: 1240, scheme: "light", hash: "#all" });
  await shot(browser, { file: "detail-light.png", width: 1440, height: 1000, scheme: "light", hash: "#all",
    prepare: async (p) => { await p.locator("#games .game").first().click(); await p.waitForTimeout(900); } });
  await shot(browser, { file: "preview-ko-phone.png", width: 390, height: 844, scheme: "dark", lang: "ko", hash: "#preview" });
  await browser.close();
} finally {
  server.kill();
}
