import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import type { Page } from '@playwright/test';

async function pickLang(page: Page, code: string) {
  await page.locator('#lang-btn').click();
  await page.locator(`#lang-list [data-lang="${code}"]`).click();
  await expect(page.locator('#lang-list')).toBeHidden();
}

test('landing follows the system light/dark setting and forgets a theme saved by the old button', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cookingfoil:theme', 'dark'));
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
  expect(await background()).toBe('rgb(242, 241, 238)');
  await expect(page.locator('#theme-btn')).toHaveCount(0);

  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(background).toBe('rgb(22, 22, 26)');
  fs.mkdirSync('out/web', { recursive: true });
  await page.screenshot({ path: 'out/web/landing-dark.png' });
});

test('landing names the shop, shows its status and links to the admin page', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'CookingFoil', exact: true })).toBeVisible();
  await expect(page.locator('#status-text')).not.toHaveClass(/sk/);
  await expect(page.locator('#acct-list')).toBeHidden();
  await page.locator('#acct-btn').click();
  await expect(page.locator('#acct-list a[href="/admin"]')).toBeVisible();
  await expect(page.locator('#pair-link')).toHaveAttribute('href', '/pair');
  await page.keyboard.press('Escape');
  await expect(page.locator('#acct-list')).toBeHidden();
});

test('genre chips filter the library by English key and follow the page language', async ({ page }) => {
  await page.route('**/api/shop/sections', (route) => route.fulfill({
    json: {
      sections: [{ id: 'all', title: 'All', items: [{ app_type: 'base', title_id: '0100000000010000', categories: ['Party'] }] }],
      genres: { Party: { en: 'Party', ko: '파티', ja: 'パーティー', zh: '派對' } },
    },
  }));
  await page.goto('/');
  await pickLang(page, 'ko');
  const party = page.locator('#genre-chips [data-genre="Party"]');
  await expect(party).toContainText('파티');
  await pickLang(page, 'en');
  await expect(party).toContainText('Party');
  await pickLang(page, 'ja');
  await expect(party).toContainText('パーティー');
  await expect(page.locator('.tabs [data-tab="games"]')).toHaveText('すべてのゲーム');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
  await pickLang(page, 'zh');
  await expect(party).toContainText('派對');
  await pickLang(page, 'en');
  await party.click();
  await expect(party).toHaveClass(/active/);
  await expect(page.locator('#games .game')).toHaveCount(1);
});

test('score badges read the section scores and label them in the page language', async ({ page }) => {
  await page.route('**/api/shop/sections', (route) => route.fulfill({
    json: {
      sections: [{ id: 'all', title: 'All', items: [{
        app_type: 'base', title_id: '0100000000010000', categories: ['Party'],
        score: 75, score_count: 25575, score_source: 'steam', score_label: 'Mostly Positive',
      }] }],
      genres: { Party: { en: 'Party', ko: '파티', ja: 'パーティー', zh: '派對' } },
      score_labels: { 'Mostly Positive': { en: 'Mostly Positive', ko: '대체로 긍정적', ja: 'やや好評', zh: '大多好評' } },
    },
  }));
  await page.goto('/');
  await pickLang(page, 'ko');
  const pill = page.locator('#games .score-badge');
  await expect(pill).toHaveText('75');
  // the 70s band, as on the console client
  await expect(pill).toHaveClass(/s70/);
  const chip = page.locator('#steam-chips [data-steam="Mostly Positive"]');
  await expect(chip).toContainText('대체로 긍정적');
  await chip.click();
  await expect(page.locator('#games .game')).toHaveCount(1);
  await expect(pill).toHaveAttribute('title', '75 · 대체로 긍정적 · 25,575명');
  await pickLang(page, 'en');
  await expect(page.locator('#games .score-badge')).toHaveAttribute('title', '75 · Mostly Positive · 25,575 reviews');
});

test('all games has list and preview sub-tabs, and the choice is remembered', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.tabs [data-tab="games"]')).toHaveClass(/active/);
  await expect(page.locator('.tabs [data-tab="preview"]')).toHaveCount(0);
  await expect(page.locator('#shop-url')).toBeVisible();
  await expect(page.locator('#games .game')).toHaveCount(1);
  await page.locator('#subtabs [data-view="preview"]').click();
  await expect(page.locator('#search')).toBeHidden();
  await expect(page.locator('#shop-url')).toBeVisible();
  await expect(page).toHaveURL(/#preview$/);
  await page.goto('/');
  await expect(page.locator('.tabs [data-tab="games"]')).toHaveClass(/active/);
  await expect(page.locator('#subtabs [data-view="preview"]')).toHaveClass(/active/);
  await page.locator('#subtabs [data-view="games"]').click();
  await expect(page).toHaveURL(/#all$/);
  await page.setViewportSize({ width: 1280, height: 300 });
  await page.reload();
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test('the language menu opens on demand, shows the current code and closes on Escape', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#lang-list')).toBeHidden();
  await pickLang(page, 'ja');
  await expect(page.locator('#lang-current')).toHaveText('JA');
  await page.locator('#lang-btn').click();
  await expect(page.locator('#lang-list [data-lang="ja"]')).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await expect(page.locator('#lang-list')).toBeHidden();
  await expect(page.locator('#acct-btn')).toHaveAttribute('aria-label', 'メニュー');
});

test('card names follow the page language from the sections names, falling back to English', async ({ page }) => {
  await page.route('**/api/shop/sections', (route) => route.fulfill({
    json: { sections: [{ id: 'all', title: 'All', items: [{
      app_type: 'base', title_id: '0100000000010000', names: { ko: '테스트 게임', en: 'Test Game EN', ja: 'テストゲーム' },
    }] }], genres: {}, score_labels: {} },
  }));
  await page.goto('/');
  const name = page.locator('#games .game .name').first();
  await pickLang(page, 'ja');
  await expect(name).toHaveText('テストゲーム');
  await pickLang(page, 'zh');
  await expect(name).toHaveText('Test Game EN');
  await pickLang(page, 'ko');
  await expect(name).toHaveText('테스트 게임');
});

test('the stats panel draws composition, storage and recent-month charts from the file list', async ({ page }) => {
  const now = Date.now();
  const files = [
    { url: 'a', size: 4e9, kind: 'base', mtime: now, titleId: '0100000000010000' },
    { url: 'b', size: 2e9, kind: 'base', mtime: now, titleId: '0100000000020000' },
    { url: 'c', size: 1e9, kind: 'update', mtime: now, titleId: '0100000000010800', baseTitleId: '0100000000010000' },
  ];
  await page.route('**/shop.json', (route) => route.fulfill({ json: { files, titledb: {} } }));
  await page.goto('/');
  await pickLang(page, 'en');
  const charts = page.locator('#charts');
  await expect(charts).toBeVisible();
  await expect(charts.locator('.chart')).toHaveCount(3);
  await expect(charts.locator('.chart').first()).toContainText('3 total');
  await expect(charts.locator('.legend').first()).toContainText('Base');
  await pickLang(page, 'ko');
  await expect(charts.locator('.chart h4').first()).toContainText('구성');
});

test('on a phone the page fits the screen width with a long shop address', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('#status-text')).not.toHaveClass(/sk/);
  await page.locator('#shop-url').evaluate((el) => { el.textContent = 'https://a-rather-long-shop-host.example.com:38000/shop.tfl'; });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBe(0);
  fs.mkdirSync('out/web', { recursive: true });
  await page.screenshot({ path: 'out/web/landing-phone.png' });
});

test('on a phone all four views fit one row in every language', async ({ page }) => {
  for (const width of [390, 360]) {
    await page.setViewportSize({ width, height: 800 });
    for (const lang of ['ko', 'en', 'ja', 'zh']) {
      await page.addInitScript((l) => { try { localStorage.setItem('cookingfoil:lang', l); } catch { /* none */ } }, lang);
      await page.goto('/');
      await expect(page.locator('html')).toHaveAttribute('lang', lang);
      // Retro and homebrew show only with content; the test server has none, so show them as a full server would.
      await page.$$eval('nav.tabs button', (bs) => bs.forEach((b) => { b.hidden = false; }));
      const nav = await page.locator('nav.tabs').evaluate((n) => ({ over: n.scrollWidth - n.clientWidth, right: n.getBoundingClientRect().right }));
      expect(nav.over, `${lang} at ${width}px`).toBe(0);
      expect(nav.right, `${lang} at ${width}px`).toBeLessThanOrEqual(width);
      await expect(page.locator('nav.tabs button').last()).toBeInViewport({ ratio: 1 });
    }
  }
});

test("a game's detail shows the patches it needs apart from its other patches", async ({ page }) => {
  const patch = (id: string, name: string, required: boolean) => ({
    id: `0100000000010000-${id}`, title_id: '0100000000010000', name, kinds: ['romfs'], size: 52_613_349_376, files: 109,
    hash: 'h', description: `${name} 설명`, required,
  });
  await page.route('**/api/title/0100000000010000*', async (route) => {
    const res = await route.fetch();
    const body = res.ok() ? await res.json() : {};
    await route.fulfill({ json: { ...body, patches: [patch('aaaaaaaaaaaa', '성능 패치', false), patch('bbbbbbbbbbbb', '게임 데이터', true)] } });
  });
  await page.addInitScript(() => { try { localStorage.setItem('cookingfoil:lang', 'ko'); } catch { /* none */ } });
  await page.goto('/');
  await page.locator('.game').first().click();
  const need = page.locator('#modal-patches .mp-group.need');
  await expect(need.locator('h4')).toContainText('함께 설치해야 하는 패치');
  await expect(need.locator('.xname')).toHaveText(['게임 데이터']);
  await expect(need.locator('a.btn')).toHaveAttribute('href', '/api/patches/0100000000010000-bbbbbbbbbbbb/download');
  await expect(page.locator('#modal-patches .mp-group:not(.need) .xname')).toHaveText(['성능 패치']);
  // Above the description, so it isn't missed.
  const order = await page.evaluate(() => {
    const a = document.getElementById('modal-patches')!, b = document.getElementById('modal-desc')!;
    return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(order).toBe(true);
  fs.mkdirSync('out/web', { recursive: true });
  await page.locator('#modal-patches').screenshot({ path: 'out/web/modal-patches.png' });
test('on a phone the search box and the sort box share the top row, the kind chips under them', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const box = async (sel: string) => (await page.locator(sel).first().boundingBox())!;
  const [search, sort, chips] = [await box('#search'), await box('#sort'), await box('#chips')];
  expect(Math.abs(search.y - sort.y)).toBeLessThan(4);
  expect(Math.abs(search.width - sort.width)).toBeLessThan(4);
  expect(chips.y).toBeGreaterThan(search.y + search.height - 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  fs.mkdirSync('out/web', { recursive: true });
  await page.locator('#search').locator('..').screenshot({ path: 'out/web/phone-toolbar.png' });
});
