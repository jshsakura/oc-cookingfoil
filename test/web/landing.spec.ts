import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import type { Page } from '@playwright/test';

async function pickLang(page: Page, code: string) {
  await page.locator('#lang-btn').click();
  await page.locator(`#lang-list [data-lang="${code}"]`).click();
  await expect(page.locator('#lang-list')).toBeHidden();
}

test('landing follows the system until the theme switch in the account menu is used, then keeps it', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('cookingfoil:lang', 'ko'); } catch { /* none */ } });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  const root = page.locator('html');
  const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const themeColor = () => page.locator('meta[name="theme-color"]').getAttribute('content');
  await expect(root).not.toHaveAttribute('data-theme', /.+/);
  expect(await background()).toBe('rgb(242, 241, 238)');

  await page.locator('#acct-btn').click();
  const dark = page.locator('#acct-list').getByRole('menuitemcheckbox', { name: '어두운 테마' });
  await expect(dark).toHaveAttribute('aria-checked', 'false');
  await dark.click();
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await expect(dark).toHaveAttribute('aria-checked', 'true');
  expect(await background()).toBe('rgb(22, 22, 26)');
  await expect.poll(themeColor).toBe('#16161a');
  expect(await page.evaluate(() => localStorage.getItem('cookingfoil:theme'))).toBe('dark');

  // applied in the head, so the first paint is already dark
  await page.reload();
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await expect.poll(themeColor).toBe('#16161a');
  fs.mkdirSync('out/web', { recursive: true });
  await page.locator('#acct-btn').click();
  await expect(dark).toHaveAttribute('aria-checked', 'true');
  await page.screenshot({ path: 'out/web/landing-dark.png' });

  // switched off it is light, kept even when the system turns dark
  await dark.click();
  await expect(root).toHaveAttribute('data-theme', 'light');
  expect(await page.evaluate(() => localStorage.getItem('cookingfoil:theme'))).toBe('light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(background).toBe('rgb(242, 241, 238)');
  await expect.poll(themeColor).toBe('#f2f1ee');
});

test('a stored light theme wins over a dark system setting, and the menu labels follow the page language', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('cookingfoil:theme', 'light'); localStorage.setItem('cookingfoil:lang', 'en'); } catch { /* none */ } });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(242, 241, 238)');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#f2f1ee');
  await page.locator('#acct-btn').click();
  await expect(page.locator('#acct-list').getByRole('menuitemcheckbox', { name: 'Dark theme' })).toHaveAttribute('aria-checked', 'false');
});

test('the web page has no upload: no floating button and no upload item in the menu', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('.fab')).toHaveCount(0);
  await page.locator('#acct-btn').click();
  await expect(page.locator('#acct-list [id^="upload"]')).toHaveCount(0);
  fs.mkdirSync('out/web', { recursive: true });
  await page.screenshot({ path: 'out/web/menu-390.png' });
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
    await route.fulfill({ json: { ...body, patches: [patch('aaaaaaaaaaaa', '성능 패치', false),
      { ...patch('bbbbbbbbbbbb', '게임 데이터', true), update_version: 2097152, game_version: '1.0.32.0' }] } });
  });
  await page.addInitScript(() => { try { localStorage.setItem('cookingfoil:lang', 'ko'); } catch { /* none */ } });
  await page.goto('/');
  await page.locator('.game').first().click();
  const need = page.locator('#modal-patches .mp-group.need');
  await expect(need.locator('h4')).toContainText('함께 설치해야 하는 패치');
  await expect(need.locator('.xname')).toHaveText(['게임 데이터']);
  await expect(need.locator('a.btn')).toHaveAttribute('href', '/api/patches/0100000000010000-bbbbbbbbbbbb/download');
  // The update it was made for is a note only: every update stays listed and installable.
  await expect(need.locator('.xmeta')).toContainText('v2097152 (1.0.32.0)용');
  // The others go with what to install, below the description.
  await expect(page.locator('#modal-patches .mp-group')).toHaveCount(1);
  await expect(page.locator('#modal-install .mp-group:not(.need) .xmeta')).not.toContainText('용');
  await expect(page.locator('#modal-install .mp-group:not(.need) .xname')).toHaveText(['성능 패치']);
  // Above the description, so it isn't missed.
  const order = await page.evaluate(() => {
    const a = document.getElementById('modal-patches')!, b = document.getElementById('modal-desc')!;
    return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(order).toBe(true);
  fs.mkdirSync('out/web', { recursive: true });
  await page.locator('#modal-patches').screenshot({ path: 'out/web/modal-patches.png' });
});

test("a game's detail lays out what the console shows, in the console's order", async ({ page }) => {
  await page.route('**/api/title/0100000000010000*', (route) => route.fulfill({ json: {
    id: '0100000000010000', name: 'Test Game', names: { ko: '테스트 게임', en: 'Test Game' }, publisher: 'Nintendo',
    description: '바다를 건너는 모험입니다.', notes: '업데이트를 함께 설치합니다.', releaseDate: 20170303, region: 'KR', rating: 12, ratingContent: ['폭력'],
    numberOfPlayers: 4, categories: ['Action', 'RPG'], categoryLabels: ['액션', 'RPG'],
    price: { country: 'KR', regular: '64,800원', discount: '32,400원', discountEnds: '2999-01-01T00:00:00Z' },
    latestVersion: 131072, updates: [{ version: 65536, date: 20170401 }, { version: 131072, date: 20170501 }], dlcTotal: 3,
    requiredFirmware: '16.0.0', score: 92, scoreCount: 1234, scoreLabel: '압도적으로 긍정적', scoreLabelKey: 'Overwhelmingly Positive',
    screenshots: [], patches: [],
  } }));
  await page.route('**/api/shop/sections', (route) => route.fulfill({ json: {
    sections: [{ id: 'all', title: 'All', items: [
      { app_type: 'base', title_id: '0100000000010000', app_version: 0, languages: ['ko', 'en'], install_size: 9e9 },
      { app_type: 'update', title_id: '0100000000010800', app_version: 131072, version_name: '1.2.0' },
    ] }],
    genres: {},
  } }));
  await page.route('**/shop.json', (route) => route.fulfill({ json: { files: [
    { url: 'a.nsp', name: 'Test Game [0100000000010000][v0]', size: 8e9, kind: 'base', mtime: 1, titleId: '0100000000010000', baseTitleId: '0100000000010000' },
    { url: 'b.nsp', name: 'Test Game [0100000000010800][v65536]', size: 5e8, kind: 'update', mtime: 1, titleId: '0100000000010800', baseTitleId: '0100000000010000' },
    { url: 'c.nsp', name: 'Test Game [0100000000010800][v131072]', size: 1e9, kind: 'update', mtime: 1, titleId: '0100000000010800', baseTitleId: '0100000000010000' },
    { url: 'd.nsp', name: 'Test Game Extra Map [0100000000011001][v0]', size: 5e8, kind: 'dlc', mtime: 1, titleId: '0100000000011001', baseTitleId: '0100000000010000' },
  ], titledb: {} } }));
  await page.addInitScript(() => { try { localStorage.setItem('cookingfoil:lang', 'ko'); } catch { /* none */ } });
  fs.mkdirSync('out/web', { recursive: true });
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await page.locator('#games .game').first().click();
    await expect(page.locator('#modal-title')).toHaveText('테스트 게임');
    await expect(page.locator('#modal-publisher')).toHaveText('Nintendo');
    await expect(page.locator('#modal-pills .pill')).toHaveText(['한글', '평점 92', '할인 32,400원', '액션, RPG']);
    // Notes come before the description.
    const notesFirst = await page.evaluate(() => Boolean(document.getElementById('modal-notes')!.compareDocumentPosition(document.getElementById('modal-desc')!) & Node.DOCUMENT_POSITION_FOLLOWING));
    expect(notesFirst).toBe(true);
    const meta = page.locator('#modal-meta');
    await expect(meta.locator('div > span')).toHaveText(['eShop 가격', '평점 · 1,234명', '출시일', '퍼블리셔', '플레이 인원', '기본 용량', '설치 용량',
      '펌웨어', '연령 등급', 'DLC', '최신 버전', '파일 형식', '지역', '타이틀 ID']);
    await expect(meta.locator('div > strong')).toHaveText(['32,400원 (64,800원)', '92 · 압도적으로 긍정적', '2017.03.03', 'Nintendo', '최대 4명', '7.45 GB', '8.38 GB',
      '16.0.0', '12 · 폭력', '3개 출시 · 여기 1개', 'v1.2.0', 'NSP', 'KR', '0100000000010000']);
    await expect(page.locator('#modal-chips .chip-line').first()).toContainText('지원 언어');
    await expect(page.locator('#modal-chips .chip-line').first().locator('.chip')).toHaveText(['한국어', '영어']);
    await expect(page.locator('#modal-chips .chip-line').nth(1).locator('.chip')).toHaveText(['액션', 'RPG']);
    // What to install: the base, the newest update only, then every DLC.
    const install = page.locator('#modal-install .extra-row');
    await expect(install.locator('.extra-name')).toHaveText(['기본 게임', '업데이트', 'Test Game Extra Map']);
    await expect(install.locator('.extra-sub')).toHaveText(['v0 · 필수', 'v1.2.0 · 최신', 'DLC']);
    await expect(install.nth(1)).toHaveAttribute('href', 'c.nsp');
    await page.waitForTimeout(450); // the modal's rise animation
    const over = await page.evaluate(() => {
      const m = document.querySelector('#modal .modal')!;
      return { page: document.documentElement.scrollWidth - document.documentElement.clientWidth, modal: m.scrollWidth - m.clientWidth };
    });
    expect(over, `at ${width}px`).toEqual({ page: 0, modal: 0 });
    // A tall window, so the shot holds the whole detail.
    await page.setViewportSize({ width, height: 2600 });
    await page.locator('#modal .modal').screenshot({ path: `out/web/switch-detail-${width}.png` });
    await page.keyboard.press('Escape');
  }
});

test("a game's detail shimmers the cells only its detail fills, then leaves out the empty ones", async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((r) => { release = r; });
  await page.route('**/api/title/0100000000010000*', async (route) => {
    await held;
    await route.fulfill({ json: { id: '0100000000010000', name: 'Test Game', releaseDate: 20170300 } });
  });
  await page.addInitScript(() => { try { localStorage.setItem('cookingfoil:lang', 'ko'); } catch { /* none */ } });
  await page.goto('/');
  await page.locator('#games .game').first().click();
  await expect(page.locator('#modal-meta .sk').first()).toBeVisible();
  await expect(page.locator('#modal-meta div', { hasText: '타이틀 ID' }).locator('strong')).toHaveText('0100000000010000');
  release();
  await expect(page.locator('#modal-meta .sk')).toHaveCount(0);
  await expect(page.locator('#modal-meta div > span')).toHaveText(['출시일', '파일 형식', '타이틀 ID']);
  await expect(page.locator('#modal-meta div', { hasText: '출시일' }).locator('strong')).toHaveText('2017.03');
  await expect(page.locator('#modal-desc .desc-empty')).toHaveText('소개 글이 아직 없습니다.');
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
      const modal = document.querySelector('#modal .modal-scroll')!;
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

test('while the library loads, placeholders in the cards\' shape hold the grid, the preview and the charts', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('cookingfoil:lang', 'ko'); } catch { /* none */ } });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/shop.json', async (route) => { await gate; await route.continue(); });
  await page.goto('/#all');

  const skeletons = page.locator('#games .game.skel');
  await expect(skeletons.first()).toBeVisible();
  await expect(page.locator('#games')).toHaveAttribute('aria-busy', 'true');
  // whole rows, so the grid has its final width from the first paint
  const { count, cols } = await page.evaluate(() => {
    const grid = document.getElementById('games')!;
    return { count: grid.querySelectorAll('.game.skel').length, cols: getComputedStyle(grid).gridTemplateColumns.split(' ').length };
  });
  expect(count % cols).toBe(0);
  expect(await page.locator('#charts .chart.skel').count()).toBeGreaterThan(0);
  const skelHeight = (await skeletons.first().boundingBox())!.height;
  // the shimmer follows the theme tokens
  const shimmer = await page.locator('#games .game.skel .cover').first().evaluate((el) => getComputedStyle(el).backgroundImage);
  expect(shimmer).toContain('linear-gradient');
  fs.mkdirSync('out/web', { recursive: true });
  await page.screenshot({ path: 'out/web/loading-list.png' });

  await page.locator('#subtabs button', { hasText: '미리보기' }).click();
  await expect(page.locator('#hero.skel')).toBeVisible();
  await expect(page.locator('#home-rows .home-row.skel')).toHaveCount(3);
  await page.screenshot({ path: 'out/web/loading-preview.png' });

  release();
  await expect(page.locator('.skel')).toHaveCount(0);
  await expect(page.locator('#hero')).not.toHaveClass(/skel/);
  await page.locator('#subtabs button', { hasText: '전체' }).click();
  await expect(page.locator('#games')).toHaveAttribute('aria-busy', 'false');
  const card = page.locator('#games .game').first();
  await expect(card).toBeVisible();
  expect(Math.abs((await card.boundingBox())!.height - skelHeight)).toBeLessThanOrEqual(2);
});

test('the loading shimmer stands still for visitors who ask for less motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/shop.json', () => { /* never answers */ });
  await page.goto('/');
  const animation = await page.locator('#games .game.skel .cover').first().evaluate((el) => getComputedStyle(el).animationName);
  expect(animation).toBe('none');
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
    hash: 'h', description: '프레임을 올립니다.', required: true, version: '1.2', game_version: '1.0.32.0', update_version: 2097152,
    game: { name: 'Test Game', icon: '/api/shop/icon/0100000000010000' } };
  const hbPatch = { id: 'hb-bbbbbbbbbbbb', title_id: null, homebrew: 'portgame', name: 'HD 텍스처', kinds: ['romfs'], size: 8192, files: 2, hash: 'h', description: '' };
  await page.route('**/api/patches', (route) => route.fulfill({ json: { patches: [patch, hbPatch] } }));
  await page.route('**/api/saves*', (route) => route.fulfill({ json: { saves: [] } }));
  await page.route('**/api/homebrew?*', (route) => route.fulfill({ json: { homebrew: [{
    id: 'm-aaaaaaaaaaaa', app: 'portgame', name: 'Port Game', version: '2.0', author: 'someone', kind: 'port', size: 1048576,
    description: '다른 기종에서 옮겨 온 게임입니다.', icon_url: '', download_url: '/api/homebrew/m-aaaaaaaaaaaa/download', repo_url: null,
    bundle_url: '/api/homebrew/m-aaaaaaaaaaaa/bundle', install_dir: 'switch/portgame', released_at: '2026-09-01T00:00:00Z',
  }] } }));
  await page.addInitScript(() => { try { localStorage.setItem('cookingfoil:lang', 'ko'); } catch { /* none */ } });
  await page.goto('/#patches');

  // A game is an accordion: its items show once its card is opened.
  const row = page.locator('#patches-list .xrow', { hasText: '성능 패치' });
  const head = page.locator('#patches-list .xhead', { hasText: 'Test Game' });
  await expect(head).toHaveAttribute('aria-expanded', 'false');
  // The closed card already says what its patches are: required first, then each kind once.
  await expect(head.locator('.xbadges .pill')).toHaveText(['필수', '코드 패치']);
  await expect(row).toHaveCount(0);
  await head.click();
  await expect(head).toHaveAttribute('aria-expanded', 'true');
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
  await expect(page.locator('#xm-meta')).toContainText('맞는 업데이트');
  await expect(page.locator('#xm-meta')).toContainText('v2097152');
  await expect(page.locator('#xm-download')).toHaveAttribute('href', '/api/patches/0100000000010000-aaaaaaaaaaaa/download');
  await expect(page.locator('#xm-where .p-full')).toHaveText('sdmc:/atmosphere/contents/0100000000010000/');
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
  // The same facts the client shows: maker and version, type and size, and where it installs.
  await expect(page.locator('#xm-sub')).toHaveText('someone · v2.0');
  await expect(page.locator('#xm-pills')).toContainText('포트');
  await expect(page.locator('#xm-pills')).toContainText('1.00 MB');
  await expect(page.locator('#xm-meta')).toContainText('2026.09.01');
  await expect(page.locator('#xm-where')).toHaveText('설치 위치: sdmc:/switch/portgame/');
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
  // The card stays as it was left, so it is opened only when closed.
  const gameHead = page.locator('#patches-list .xhead', { hasText: 'Test Game' });
  if ((await gameHead.getAttribute('aria-expanded')) !== 'true') await gameHead.click();
  await page.locator('#patches-list .xrow', { hasText: '성능 패치' }).click();
  await expect(page.locator('#xm-title')).toBeVisible();
  await page.waitForTimeout(450); // the modal's rise animation
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBe(0);
  // On a phone the install path keeps to one line, its middle shortened, its whole form on hold.
  const where = page.locator('#xm-where .path-code');
  await expect(where.locator('.p-short')).toHaveText('sdmc:/…/contents/0100000000010000/');
  await expect(where.locator('.p-short')).toHaveAttribute('aria-hidden', 'true');
  await expect(where).toHaveAttribute('title', 'sdmc:/atmosphere/contents/0100000000010000/');
  const lines = await where.evaluate((el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)));
  expect(lines).toBe(1);
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
  // measured once the cards have finished rising into place
  await page.locator('#charts').evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)));
  const tops = await cards.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  expect(new Set(tops).size).toBe(1);
  fs.mkdirSync('out/web', { recursive: true });
  await page.locator('#charts').screenshot({ path: 'out/web/charts-row.png' });
});

test('the chart row keeps four slots while the genres load, and the drawn cards stay in place when they arrive', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/shop/sections', async (route) => {
    await gate;
    await route.fulfill({ json: { sections: [{ id: 'all', title: 'All', items: [
      { app_type: 'base', title_id: '0100000000010000', categories: ['Action', 'RPG'] },
    ] }], genres: {} } });
  });
  await page.route('**/shop.json', (route) => route.fulfill({ json: { files: [
    { url: 'a', name: 'Big Game [0100000000010000][v0].nsp', size: 8e9, kind: 'base', mtime: Date.now(), titleId: '0100000000010000' },
  ], titledb: {} } }));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  const cards = page.locator('#charts .chart');
  await expect(page.locator('#charts .chart:not(.skel)')).toHaveCount(3);
  await expect(cards).toHaveCount(4);
  await expect(page.locator('#charts .chart.c3')).toHaveCount(4);
  await expect(cards.nth(3)).toHaveClass(/skel/);
  await expect(page.locator('#genre-chips .chip.skel').first()).toBeVisible();
  await page.evaluate(() => { (document.querySelector('#charts .chart') as HTMLElement).dataset.kept = '1'; });

  release();
  await expect(page.locator('#charts .chart.skel')).toHaveCount(0);
  await expect(cards).toHaveCount(4);
  await expect(page.locator('#charts .chart.c3')).toHaveCount(4);
  await expect(page.locator('#charts .chart').first()).toHaveAttribute('data-kept', '1');
  await expect(page.locator('#genre-chips .chip.skel')).toHaveCount(0);
});

test("on a phone a game's window has a close button at the top right that closes it", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#all');
  await page.locator('#games .game:not(.skel)').first().click();
  await expect(page.locator('#modal')).toHaveClass(/open/);
  const x = page.locator('#modal .modal-x');
  await expect(x).toBeVisible();
  const box = (await x.boundingBox())!;
  const sheet = (await page.locator('#modal .modal').boundingBox())!;
  expect(box.y - sheet.y).toBeLessThan(24);
  expect(sheet.x + sheet.width - (box.x + box.width)).toBeLessThan(24);
  expect(await x.getAttribute('aria-label')).toBeTruthy();
  // still there after scrolling the window to the bottom
  await page.locator('#modal .modal').evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await expect(x).toBeInViewport();
  fs.mkdirSync('out/web', { recursive: true });
  await page.screenshot({ path: 'out/web/modal-phone-close.png' });
  await x.click();
  await expect(page.locator('#modal')).not.toHaveClass(/open/);
});

test('patches and homebrew open newest update first, and the order picked is kept', async ({ page }) => {
  await page.route('**/api/shop/info*', async (route) => {
    const res = await route.fetch();
    const body = res.ok() ? await res.json() : {};
    await route.fulfill({ json: { ...body, features: [...(body.features ?? []), 'user-patches', 'shop-saves', 'homebrew'] } });
  });
  const patch = (id: string, tid: string, game: string, name: string, at: string, size: number) => ({
    id, title_id: tid, name, kinds: ['romfs'], size, files: 1, hash: 'h', description: '', updated_at: at, game: { name: game } });
  await page.route('**/api/patches', (route) => route.fulfill({ json: { patches: [
    patch('a-1', '0100000000010000', 'Alpha', 'Alpha old', '2026-01-01T00:00:00Z', 10),
    patch('b-1', '0100000000020000', 'Bravo', 'Bravo new', '2026-10-01T00:00:00Z', 5),
    patch('a-2', '0100000000010000', 'Alpha', 'Alpha mid', '2026-05-01T00:00:00Z', 900),
  ] } }));
  await page.route('**/api/saves*', (route) => route.fulfill({ json: { saves: [] } }));
  const app = (id: string, name: string, at: string) => ({ id, app: id, name, kind: 'tool', size: 1, released_at: at, icon_url: '', download_url: '/x' });
  await page.route('**/api/homebrew?*', (route) => route.fulfill({ json: { homebrew: [
    app('zed', 'Zed Tool', '2026-09-01T00:00:00Z'), app('abc', 'Abc Tool', '2025-01-01T00:00:00Z'),
  ] } }));
  await page.addInitScript(() => { try { localStorage.setItem('cookingfoil:lang', 'ko'); } catch { /* none */ } });
  await page.goto('/#patches');

  const heads = page.locator('#patches-list .xgroup .xhead strong');
  await expect(heads).toHaveText(['Bravo', 'Alpha']);
  await page.locator('#patches-list .xhead', { hasText: 'Alpha' }).click();
  await expect(page.locator('#patches-list .xgroup').nth(1).locator('.xname')).toHaveText(['Alpha mid', 'Alpha old']);
  await expect(page.locator('#patches-sort')).toHaveValue('updated');
  await page.locator('#patches-sort').selectOption('name');
  await expect(heads).toHaveText(['Alpha', 'Bravo']);
  await page.locator('#patches-sort').selectOption('size');
  await expect(heads).toHaveText(['Alpha', 'Bravo']);
  await expect(page.locator('#patches-list .xgroup').first().locator('.xname')).toHaveText(['Alpha mid', 'Alpha old']);

  await page.goto('/#tools');
  await expect(page.locator('#tools-list .xname')).toHaveText(['Zed Tool', 'Abc Tool']);
  await page.locator('#tools-sort').selectOption('name');
  await expect(page.locator('#tools-list .xname')).toHaveText(['Abc Tool', 'Zed Tool']);
  await page.reload();
  await expect(page.locator('#tools-sort')).toHaveValue('name');
  await expect(page.locator('#tools-list .xname')).toHaveText(['Abc Tool', 'Zed Tool']);
  await page.goto('/#patches');
  await expect(page.locator('#patches-sort')).toHaveValue('size');
  await page.setViewportSize({ width: 390, height: 844 });
  fs.mkdirSync('out/web', { recursive: true });
  await page.screenshot({ path: 'out/web/patches-sort-phone.png' });
});

test('saves page by game, so a game with many saves stays on one page and loads under its card when opened', async ({ page }) => {
  await page.route('**/api/shop/info*', async (route) => {
    const res = await route.fetch();
    const body = res.ok() ? await res.json() : {};
    await route.fulfill({ json: { ...body, features: [...(body.features ?? []), 'shop-saves'] } });
  });
  const save = (tid: string, game: string, n: number) => ({ id: `${tid}-${String(n).padStart(12, '0')}`, titleId: tid, name: `${game} save ${n}`,
    description: '', size: 1024, files: 1, hash: 'h', updatedAt: 1_790_000_000 - n, game: { name: game }, url: '/x' });
  const saves = Array.from({ length: 30 }, (_, n) => save('0100000000010000', 'Big Game', n));
  for (let g = 0; g < 21; g++) saves.push(save(`0100000002${String(g).padStart(2, '0')}0000`, `Game ${String(g).padStart(2, '0')}`, 100 + g));
  // saves-by-game: the games first, one game's saves when its card opens.
  const asked: string[] = [];
  await page.route('**/api/saves*', async (route) => {
    const url = new URL(route.request().url());
    asked.push(url.search);
    const key = url.searchParams.get('game');
    if (url.searchParams.get('view') === 'games') {
      const rows = new Map<string, { key: string; titleId: string; game: { name: string }; count: number; size: number; updatedAt: number }>();
      for (const s of saves) {
        const row = rows.get(s.titleId) ?? { key: s.titleId, titleId: s.titleId, game: s.game, count: 0, size: 0, updatedAt: 0 };
        row.count++; row.size += s.size; row.updatedAt = Math.max(row.updatedAt, s.updatedAt);
        rows.set(s.titleId, row);
      }
      return route.fulfill({ json: { games: [...rows.values()] } });
    }
    if (key) { await new Promise((r) => setTimeout(r, 300)); return route.fulfill({ json: { saves: saves.filter((s) => s.titleId === key) } }); }
    return route.fulfill({ json: { saves } });
  });
  await page.route('**/api/patches', (route) => route.fulfill({ json: { patches: [] } }));
  await page.addInitScript(() => { try { localStorage.setItem('cookingfoil:lang', 'ko'); } catch { /* none */ } });
  await page.goto('/#saves');
  await page.locator('#saves-sort').selectOption('name');
  await expect(page.locator('#saves-list .xgroup')).toHaveCount(20);
  await expect(page.locator('#saves-pager .info')).toHaveText('1–20 / 총 22');
  const big = page.locator('#saves-list .xhead', { hasText: 'Big Game' });
  await expect(big.locator('.n')).toHaveText('30개');
  expect(asked.some((q) => q.includes('game='))).toBe(false);
  await big.click();
  // Its saves are fetched when it opens, with loading rows meanwhile.
  await expect(page.locator('#saves-list .xgroup', { hasText: 'Big Game' }).locator('.xrow.xskel').first()).toBeVisible();
  await expect(page.locator('#saves-list .xgroup', { hasText: 'Big Game' }).locator('.xrow:not(.xskel)')).toHaveCount(30);
  expect(asked.filter((q) => q.includes('game=0100000000010000'))).toHaveLength(1);
  await big.click();
  await expect(page.locator('#saves-list .xgroup', { hasText: 'Big Game' }).locator('.xbody')).toBeHidden();
  // A search reads the whole list once and opens what it found.
  await page.locator('#saves-search').fill('save 101');
  await expect(page.locator('#saves-list .xgroup')).toHaveCount(1);
  await expect(page.locator('#saves-list .xrow')).toHaveText([/Game 01 save 101/]);
});
