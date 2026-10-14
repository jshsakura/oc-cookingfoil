import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import type { Page } from '@playwright/test';

async function pickLang(page: Page, code: string) {
  await page.locator('#lang-btn').click();
  await page.locator(`#lang-list [data-lang="${code}"]`).click();
  await expect(page.locator('#lang-list')).toBeHidden();
}

test('landing follows the system until a theme is picked in the account menu, then keeps it', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('cookingfoil:lang', 'ko'); } catch { /* none */ } });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  const root = page.locator('html');
  const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const themeColor = () => page.locator('meta[name="theme-color"]').getAttribute('content');
  await expect(root).not.toHaveAttribute('data-theme', /.+/);
  expect(await background()).toBe('rgb(242, 241, 238)');

  await page.locator('#acct-btn').click();
  const choice = (name: string) => page.locator('#acct-list').getByRole('menuitemradio', { name });
  await expect(choice('시스템 설정 따르기')).toHaveAttribute('aria-checked', 'true');
  await choice('어두운 테마').click();
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await expect(choice('어두운 테마')).toHaveAttribute('aria-checked', 'true');
  await expect(choice('시스템 설정 따르기')).toHaveAttribute('aria-checked', 'false');
  expect(await background()).toBe('rgb(22, 22, 26)');
  await expect.poll(themeColor).toBe('#16161a');
  expect(await page.evaluate(() => localStorage.getItem('cookingfoil:theme'))).toBe('dark');

  // applied in the head, so the first paint is already dark
  await page.reload();
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await expect.poll(themeColor).toBe('#16161a');
  fs.mkdirSync('out/web', { recursive: true });
  await page.locator('#acct-btn').click();
  await page.screenshot({ path: 'out/web/landing-dark.png' });

  await choice('시스템 설정 따르기').click();
  await expect(root).not.toHaveAttribute('data-theme', /.+/);
  expect(await page.evaluate(() => localStorage.getItem('cookingfoil:theme'))).toBeNull();
  await expect.poll(themeColor).toBe('#f2f1ee');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(background).toBe('rgb(22, 22, 26)');
  await expect.poll(themeColor).toBe('#16161a');
});

test('a stored light theme wins over a dark system setting, and the menu labels follow the page language', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('cookingfoil:theme', 'light'); localStorage.setItem('cookingfoil:lang', 'en'); } catch { /* none */ } });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(242, 241, 238)');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#f2f1ee');
  await page.locator('#acct-btn').click();
  await expect(page.locator('#acct-list').getByRole('menuitemradio', { name: 'Light theme' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#acct-list').getByRole('menuitemradio')).toHaveText(['Match system setting', 'Light theme', 'Dark theme']);
});

test('the page shares a large image card whose image is an absolute URL on this server', async ({ page, request }) => {
  await page.goto('/');
  const image = await page.locator('meta[property="og:image"]').getAttribute('content');
  expect(image).toBe('http://127.0.0.1:3188/assets/og-image.png');
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute('content', 'summary_large_image');
  await expect(page.locator('meta[name="twitter:image"]')).toHaveAttribute('content', image!);
  const res = await request.get(image!);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toBe('image/png');
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
  await expect(page.locator('#status')).toBeVisible();
  await expect(page.locator('#games .game')).toHaveCount(1);
  await page.locator('#subtabs [data-view="preview"]').click();
  await expect(page.locator('#search')).toBeHidden();
  await expect(page.locator('#status')).toBeVisible();
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
  // Games, updates, DLC and size; how the server finds names is the admin page's business.
  await expect(page.locator('#stat-games')).toHaveText('2');
  await expect(page.locator('#stat-updates')).toHaveText('1');
  await expect(page.locator('#stat-dlc')).toHaveText('0');
  await expect(page.locator('#stat-size-sub')).toHaveText('파일 3개');
  await expect(page.locator('#namehealth')).toHaveCount(0);
  await expect(page.locator('.stats-panel')).not.toContainText('TITLEDB');
  fs.mkdirSync('out/web', { recursive: true });
  await page.locator('.stats-panel').screenshot({ path: 'out/web/stats-panel.png' });
});

test('on a phone the page fits the screen width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('#status-text')).not.toHaveClass(/sk/);
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
});

test("a game's long description runs at full height, so only the modal scrolls", async ({ page }) => {
  const description = Array.from({ length: 40 }, (_, i) => `${i + 1}번째 문단입니다. 이 게임의 긴 설명이 모달 안에서 따로 스크롤되지 않고 그대로 이어집니다.`).join('\n\n');
  await page.route('**/api/title/0100000000010000*', async (route) => {
    const res = await route.fetch();
    const body = res.ok() ? await res.json() : {};
    await route.fulfill({ json: { ...body, description, notes: '함께 설치할 것을 적은 메모입니다.\n'.repeat(12) } });
  });
  fs.mkdirSync('out/web', { recursive: true });
  for (const width of [1280, 360]) {
    await page.setViewportSize({ width, height: 760 });
    await page.goto('/');
    await page.locator('.game').first().click();
    const desc = page.locator('#modal-desc');
    await expect(desc).toContainText('40번째 문단입니다');
    const boxes = await page.evaluate(() => {
      const inner = (id: string) => { const el = document.getElementById(id)!; return { scroll: el.scrollHeight, client: el.clientHeight, oy: getComputedStyle(el).overflowY }; };
      const modal = document.querySelector('#modal .modal')!;
      return { desc: inner('modal-desc'), notes: inner('modal-notes'), modal: { scroll: modal.scrollHeight, client: modal.clientHeight, sw: modal.scrollWidth, cw: modal.clientWidth } };
    });
    for (const box of [boxes.desc, boxes.notes]) {
      expect(box.scroll).toBeLessThanOrEqual(box.client + 1);
      expect(box.oy).toBe('visible');
    }
    expect(boxes.modal.scroll).toBeGreaterThan(boxes.modal.client);
    expect(boxes.modal.sw).toBeLessThanOrEqual(boxes.modal.cw);
    await page.locator('#modal .modal').screenshot({ path: `out/web/modal-desc-${width}.png` });
    await page.keyboard.press('Escape');
  }
});

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

test('the title count beside list and preview counts each game once', async ({ page }) => {
  await page.route('**/shop.json', async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    const one = body.files[0];
    // The same game as two files, plus another game and its update: two titles.
    body.files = [one, { ...one, url: one.url + '?2', name: one.name.replace('.nsp', ' (KR).nsp') },
      { ...one, url: one.url + '?3', name: 'Other [0100000000020000][v0].nsp', titleId: '0100000000020000', baseTitleId: '0100000000020000' },
      { ...one, url: one.url + '?4', name: 'Other [0100000000020800][v65536].nsp', titleId: '0100000000020800', baseTitleId: '0100000000020000', kind: 'update' }];
    await route.fulfill({ json: body });
  });
  await page.addInitScript(() => { try { localStorage.setItem('cookingfoil:lang', 'ko'); } catch { /* none */ } });
  await page.goto('/');
  await expect(page.locator('#status-text')).toHaveText('타이틀 2개 서비스 중');
  const [tabs, count] = [await page.locator('#subtabs').boundingBox(), await page.locator('#status').boundingBox()];
  expect(Math.abs((tabs!.y + tabs!.height / 2) - (count!.y + count!.height / 2))).toBeLessThan(6);
});

test('patches and homebrew list one line each, and a row opens its detail', async ({ page }) => {
  await page.route('**/api/shop/info*', async (route) => {
    const res = await route.fetch();
    const body = res.ok() ? await res.json() : {};
    await route.fulfill({ json: { ...body, features: [...(body.features ?? []), 'user-patches', 'shop-saves', 'homebrew'] } });
  });
  const patch = { id: '0100000000010000-aaaaaaaaaaaa', title_id: '0100000000010000', name: '성능 패치', kinds: ['exefs_patches'], size: 4096, files: 3,
    hash: 'h', description: '프레임을 올립니다.', required: true, version: '1.2', game: { name: 'Test Game', icon: '/api/shop/icon/0100000000010000' } };
  const hbPatch = { id: 'hb-bbbbbbbbbbbb', title_id: null, homebrew: 'portgame', name: 'HD 텍스처', kinds: ['romfs'], size: 8192, files: 2, hash: 'h', description: '' };
  await page.route('**/api/patches', (route) => route.fulfill({ json: { patches: [patch, hbPatch] } }));
  await page.route('**/api/saves*', (route) => route.fulfill({ json: { saves: [] } }));
  await page.route('**/api/homebrew?*', (route) => route.fulfill({ json: { homebrew: [{
    id: 'm-aaaaaaaaaaaa', app: 'portgame', name: 'Port Game', version: '2.0', author: 'someone', kind: 'port', size: 1048576,
    description: '다른 기종에서 옮겨 온 게임입니다.', icon_url: '', download_url: '/api/homebrew/m-aaaaaaaaaaaa/download', repo_url: null,
    bundle_url: '/api/homebrew/m-aaaaaaaaaaaa/bundle',
  }] } }));
  await page.addInitScript(() => { try { localStorage.setItem('cookingfoil:lang', 'ko'); } catch { /* none */ } });
  await page.goto('/#patches');

  const row = page.locator('#patches-list .xrow', { hasText: '성능 패치' });
  await expect(row).toBeVisible();
  await expect(row.locator('.btn')).toHaveCount(0);
  await expect(row.locator('.more')).toHaveText('자세히');
  await expect(row.locator('.xline')).toHaveText('프레임을 올립니다.');
  await expect(row.locator('.pill.need')).toHaveText('필수');
  await row.click();
  await expect(page.locator('#xmodal')).toHaveClass(/open/);
  await expect(page.locator('#xm-title')).toHaveText('성능 패치');
  await expect(page.locator('#xm-sub')).toHaveText('Test Game');
  await expect(page.locator('#xm-desc')).toHaveText('프레임을 올립니다.');
  await expect(page.locator('#xm-download')).toHaveAttribute('href', '/api/patches/0100000000010000-aaaaaaaaaaaa/download');
  fs.mkdirSync('out/web', { recursive: true });
  await page.locator('#xmodal .modal').screenshot({ path: 'out/web/patch-detail.png' });
  await page.keyboard.press('Escape');
  await expect(page.locator('#xmodal')).not.toHaveClass(/open/);
  await page.screenshot({ path: 'out/web/patches-list.png' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(300); // the rows' colour transition
  await page.screenshot({ path: 'out/web/patches-list-dark.png' });
  await page.emulateMedia({ colorScheme: 'light' });

  await page.goto('/#ports');
  const app = page.locator('#ports-list .xrow', { hasText: 'Port Game' });
  await expect(app).toContainText('패치 1개');
  await app.click();
  await expect(page.locator('#xm-title')).toHaveText('Port Game');
  await expect(page.locator('#xm-sections h4')).toHaveText(['이 앱의 패치']);
  await expect(page.locator('#xm-sections .xname')).toHaveText(['HD 텍스처']);
  // A folder app downloads as its whole folder, not the .nro alone.
  await expect(page.locator('#xm-download')).toHaveAttribute('href', '/api/homebrew/m-aaaaaaaaaaaa/bundle');
  await page.locator('#xmodal .modal').screenshot({ path: 'out/web/app-detail.png' });
  await page.locator('#xm-close').click();
  await expect(page.locator('#xmodal')).not.toHaveClass(/open/);

  // On a phone the rows and the detail still fit the width.
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/#patches');
  await page.locator('#patches-list .xrow').first().click();
  await expect(page.locator('#xm-title')).toBeVisible();
  await page.waitForTimeout(450); // the modal's rise animation
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBe(0);
  await page.screenshot({ path: 'out/web/patch-detail-phone.png' });
});

test('the four charts share one row: composition, storage, recent months and genres, with no review card', async ({ page }) => {
  const item = (id: string, cats: string[], label: string) => ({ app_type: 'base', title_id: id, categories: cats, score: 80, score_count: 100, score_source: 'steam', score_label: label });
  await page.route('**/api/shop/sections', (route) => route.fulfill({
    json: {
      sections: [{ id: 'all', title: 'All', items: [
        item('0100000000010000', ['Party', 'Action', 'RPG'], 'Overwhelmingly Positive'),
        item('0100000000020000', ['Puzzle', 'Sports', 'Racing', 'Action'], 'Mostly Positive'),
      ] }],
      genres: {},
    },
  }));
  await page.route('**/shop.json', (route) => route.fulfill({ json: { files: [
    { url: 'a', name: 'Big Game [0100000000010000][v0].nsp', size: 8e9, kind: 'base', mtime: Date.now(), titleId: '0100000000010000' },
    { url: 'b', name: 'Big Game [0100000000010800][v1].nsp', size: 1e9, kind: 'update', mtime: Date.now(), titleId: '0100000000010800', baseTitleId: '0100000000010000' },
  ], titledb: {} } }));
  await page.addInitScript(() => { try { localStorage.setItem('cookingfoil:lang', 'ko'); } catch { /* none */ } });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  const cards = page.locator('#charts .chart');
  await expect(cards).toHaveCount(4);
  await expect(page.locator('#charts .chart.c3')).toHaveCount(4);
  await expect(cards.nth(3)).toContainText('장르');
  await expect(cards.nth(3).locator('.hbar')).toHaveCount(4);
  await expect(page.locator('#charts')).not.toContainText('Steam');
  const tops = await cards.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  expect(new Set(tops).size).toBe(1);
  fs.mkdirSync('out/web', { recursive: true });
  await page.locator('#charts').screenshot({ path: 'out/web/charts-row.png' });
});
