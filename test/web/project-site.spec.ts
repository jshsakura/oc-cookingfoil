import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const origin = 'https://project.cookingfoil.test';
const site = path.resolve(import.meta.dirname, '../../site');
const guides = {
  en: ['README.md', 'quick-start', 'connecting-a-client', 'security'],
  ko: ['README.ko.md', '빠른-시작', '클라이언트-연결', '보안'],
  ja: ['README.ja.md', 'クイックスタート', 'クライアントの接続', 'セキュリティ'],
  zh: ['README.zh-CN.md', '快速开始', '连接客户端', '安全'],
};

async function choose(page: Page, language: string) {
  await page.locator('#lang-btn').click();
  await page.locator(`#lang-menu [data-lang="${language}"]`).click();
}

test.beforeEach(async ({ page }) => {
  await page.route('**/*', async (route) => {
    const address = new URL(route.request().url());
    if (address.origin !== origin) return route.abort();
    const file = path.resolve(site, `.${address.pathname === '/' ? '/index.html' : address.pathname}`);
    if (!file.startsWith(`${site}${path.sep}`)) return route.fulfill({ status: 404 });
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg' };
    try {
      await route.fulfill({ body: await readFile(file), contentType: types[path.extname(file)] ?? 'application/octet-stream' });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await route.fulfill({ status: 404 });
    }
  });
});

for (const [language, [file, setup, connect, security]] of Object.entries(guides)) {
  test(`the ${language} site links to its own README sections`, async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('lang', 'en'));
    await page.goto(`${origin}/?lang=${language}`);
    await expect(page.locator('html')).toHaveAttribute('data-lang', language);
    for (const [section, anchor] of [['setup', setup], ['connect', connect], ['security', security]]) {
      const link = page.locator(`[data-doc="${section}"]`).first();
      const target = decodeURI(await link.getAttribute('href'));
      expect(target).toBe(`https://github.com/jshsakura/oc-cookingfoil/blob/main/${file}#${anchor}`);
    }
    await expect(page.locator('[data-doc="overview"]').first()).toHaveAttribute('href', `https://github.com/jshsakura/oc-cookingfoil/blob/main/${file}`);
    const images = await page.locator('.app-shot img').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('src')));
    expect(images).toEqual(['screenshots/en/home-no-art.webp', 'screenshots/en/detail-no-art.webp', 'screenshots/en/downloads-no-art.webp']);
  });
}

test('changing the language updates the address and links without losing the section', async ({ page }) => {
  await page.goto(`${origin}/?lang=en#install`);
  await choose(page, 'ko');
  await expect(page).toHaveURL(`${origin}/?lang=ko#install`);
  expect(decodeURI(await page.locator('[data-doc="setup"]').getAttribute('href'))).toContain('README.ko.md#빠른-시작');
  await choose(page, 'ja');
  await expect(page).toHaveURL(`${origin}/?lang=ja#install`);
  await expect(page.locator('a[data-site-page="privacy.html"]')).toHaveAttribute('href', `${origin}/privacy.html?lang=ja`);
});

test('the language stays selected through privacy, terms and the home link', async ({ page }) => {
  await page.goto(`${origin}/?lang=en`);
  await choose(page, 'ko');
  await page.locator('a[data-site-page="privacy.html"]').click();
  await expect(page).toHaveURL(`${origin}/privacy.html?lang=ko`);
  await expect(page.locator('html')).toHaveAttribute('data-lang', 'ko');
  await choose(page, 'ja');
  await page.locator('footer a[data-site-page="terms.html"]').click();
  await expect(page).toHaveURL(`${origin}/terms.html?lang=ja`);
  await page.locator('header a[data-site-page="./"]').click();
  await expect(page).toHaveURL(`${origin}/?lang=ja`);
  await expect(page.locator('html')).toHaveAttribute('data-lang', 'ja');
});

test('language-bearing links work when browser storage is blocked', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new DOMException('Blocked', 'SecurityError'); };
    Storage.prototype.setItem = () => { throw new DOMException('Blocked', 'SecurityError'); };
  });
  await page.goto(`${origin}/?lang=ko`);
  await page.locator('a[data-site-page="privacy.html"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-lang', 'ko');
  await choose(page, 'zh');
  await page.locator('header a[data-site-page="./"]').click();
  await expect(page).toHaveURL(`${origin}/?lang=zh`);
  await expect(page.locator('html')).toHaveAttribute('data-lang', 'zh');
});

test('an unsupported language uses a supported saved preference', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('lang', 'ko'));
  await page.goto(`${origin}/?lang=constructor`);
  await expect(page.locator('html')).toHaveAttribute('data-lang', 'ko');
  await expect(page).toHaveURL(`${origin}/?lang=ko`);
});

for (const width of [390, 1440]) {
 for (const theme of ['light', 'dark']) {
  test(`navigation buttons fit at ${width}px in ${theme} mode`, async ({ page }) => {
    await page.addInitScript((theme) => localStorage.setItem('theme', theme), theme);
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`${origin}/?lang=ko`);
    for (const button of await page.locator('main a.btn').all()) {
      const dimensions = await button.boundingBox();
      expect(dimensions.height).toBeGreaterThanOrEqual(44);
      await expect(button).toHaveCSS('text-decoration-line', 'none');
      await expect(button).toHaveCSS('border-radius', '8px');
      const contrast = await button.evaluate((element) => {
        const luminance = (value) => {
          const channels = value.match(/[\d.]+/g).slice(0, 3).map(Number).map((n) => n / 255).map((n) => n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4);
          return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
        };
        const style = getComputedStyle(element);
        const colors = [luminance(style.color), luminance(style.backgroundColor)].sort((a, b) => b - a);
        return (colors[0] + 0.05) / (colors[1] + 0.05);
      });
      expect(contrast).toBeGreaterThanOrEqual(4.5);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
}
