import { test, expect, type Page } from '@playwright/test';
import { signIn } from './admin-sign-in';
import fs from 'node:fs';

// The web server's retro folder (test/web/server.mjs) holds Super Shinobi II twice,
// as the official Korean release and as a patch, and Gunbird's World and Japanese sets.

test('the web page shows one card per game and picks another version in its window', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('cookingfoil:lang', 'ko'); } catch { /* none */ } });
  await page.goto('/#retro');
  const cards = page.locator('#retro-games .game');
  await expect(cards).toHaveCount(2);
  const shinobi = cards.filter({ hasText: '슈퍼 시노비' });
  await expect(shinobi).toContainText('버전 2개');
  await expect(shinobi).toContainText('Japan, Korea');
  await shinobi.click();
  const versions = page.locator('#modal-extras .version-row');
  await expect(versions).toHaveCount(2);
  await expect(versions.first()).toContainText('추천');
  await expect(versions.first()).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#modal-extras .extras-head')).toHaveText('버전 2');
  // The official release: a Korean flag on the cover, the original title and console under the name.
  await expect(page.locator('#modal-flag')).toHaveText('🇰🇷');
  await expect(page.locator('#modal-publisher')).toContainText('Super Shinobi II, The');
  await expect(page.locator('#modal-pills .pill')).toHaveText(['ZIP', '정발']);
  // What only the game's own reply carries: its description, makers, release year and genre.
  await expect(page.locator('#modal-desc')).toContainText('Joe Musashi returns');
  const meta = page.locator('#modal-meta');
  const labels = meta.locator('div > span');
  // In the client's order, a cell without a value left out; the developer is the publisher, so it is not repeated.
  await expect(labels).toHaveText(['출시일', '제작사', '플레이 인원', '기종', '코어', '용량', '파일 형식', '지역', '베젤']);
  await expect(meta.locator('div', { hasText: '출시일' }).locator('strong')).toHaveText('1990');
  await expect(meta.locator('div', { hasText: '제작사' }).locator('strong')).toHaveText('Sega');
  await expect(meta.locator('div', { hasText: '플레이 인원' }).locator('strong')).toHaveText('1인');
  await expect(meta.locator('div', { hasText: '지역' }).locator('strong')).toHaveText('한국');
  await expect(meta.locator('.sk')).toHaveCount(0);
  await expect(page.locator('#modal-where')).toContainText('설치 위치');
  await expect(page.locator('#modal-chips .chip')).toHaveText(['액션']);
  // Versions sit above the download button.
  const order = await page.evaluate(() => {
    const a = document.getElementById('modal-extras')!, b = document.getElementById('modal-download')!;
    return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(order).toBe(true);
  fs.mkdirSync('out/web', { recursive: true });
  await page.waitForTimeout(450); // the modal's rise animation
  await page.screenshot({ path: 'out/web/retro-versions.png' });
  // A tall window, so the shot holds the whole detail.
  await page.setViewportSize({ width: 1280, height: 2600 });
  await page.locator('#modal .modal').screenshot({ path: 'out/web/retro-detail-1280.png' });
  await versions.nth(1).click();
  // The patch: its edition as pills instead of the raw tag, with the game's description.
  await expect(page.locator('#modal-pills .pill')).toHaveText(['ZIP', '한글', '일본판', 'v20130609']);
  await expect(page.locator('#modal-desc')).toContainText('Joe Musashi returns');
  await expect(page.locator('#modal-extras .version-row[aria-pressed="true"]')).toContainText('J-K v20130609');
  await expect(page.locator('#modal-extras .version-row[aria-pressed="true"] .extra-sub')).toHaveText('한글');

  // A game with nothing collected says so, and points at the table instead.
  await page.keyboard.press('Escape');
  await cards.filter({ hasNotText: '슈퍼 시노비' }).click();
  await expect(page.locator('#modal-desc .desc-empty')).toHaveText('소개 글이 아직 없습니다.아래 정보를 확인해 주세요.');
  await expect(page.locator('#modal-meta .sk')).toHaveCount(0);
});

test('the retro window fits a phone without scrolling sideways', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('cookingfoil:lang', 'ko'); } catch { /* none */ } });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#retro');
  await page.locator('#retro-games .game', { hasText: '슈퍼 시노비' }).click();
  await expect(page.locator('#modal-desc')).toContainText('Joe Musashi returns');
  await page.waitForTimeout(450); // the modal's rise animation
  const over = await page.evaluate(() => {
    const m = document.querySelector('#modal .modal')!;
    return { page: document.documentElement.scrollWidth - document.documentElement.clientWidth, modal: m.scrollWidth - m.clientWidth };
  });
  expect(over).toEqual({ page: 0, modal: 0 });
  const columns = await page.locator('#modal-meta').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
  expect(columns).toBe(2);
  fs.mkdirSync('out/web', { recursive: true });
  // A tall window, so the shot holds the whole detail.
  await page.setViewportSize({ width: 390, height: 2600 });
  await page.locator('#modal .modal').screenshot({ path: 'out/web/retro-detail-390.png' });
});

test('the admin retro tab lists the versions of a game, picks the one shown and shows arcade sets', async ({ page, request }) => {
  await signIn(page);
  await page.getByRole('link', { name: '레트로' }).click();
  await page.locator('#retro-subtabs [data-sub="dups"]').click();
  const list = page.locator('#rv-list');
  await expect(list).toContainText('공식 한국어판입니다');
  const patchRow = list.locator('.ag-row', { hasText: 'J-K v20130609' });
  await expect(patchRow.getByRole('button', { name: /J-K v20130609.* 삭제$/ })).toHaveText('삭제');
  await patchRow.getByRole('button', { name: '추천 버전으로 정합니다' }).click();
  await expect(list).toContainText('관리자가 정했습니다');
  const listed = await (await request.get('/api/retro/games?system=md')).json();
  expect(listed.games.map((g: { variant: string }) => g.variant)).toEqual(['J-K v20130609']);
  await page.screenshot({ path: 'out/web/admin-retro-versions.png', fullPage: true });
  await list.locator('.ag-row', { hasText: 'Japan, Korea' }).getByRole('button', { name: '추천 버전으로 정합니다' }).click();
  await expect(list).toContainText('공식 한국어판입니다');

  await page.locator('#retro-subtabs [data-sub="sets"]').click();
  await expect(page.locator('#rv-summary')).toContainText('게임 1개, 세트 2개입니다');
  await expect(list).toContainText('해외판입니다');
  await page.locator('#retro-subtabs [data-sub="trash"]').click();
  await expect(list).toContainText('휴지통이 비어 있습니다');
  // One sub-tab at a time: the covers are out of sight while the trash shows.
  await expect(page.locator('#tab-retro [data-sub-panel="art"]')).toBeHidden();
  await page.locator('#retro-subtabs [data-sub="art"]').click();
  await expect(page.locator('#ra-systems')).toBeVisible();
  await expect(page.locator('#ra-bios')).toContainText('roms/ 안의 My Hacks 폴더는 어느 기종인지 몰라 읽지 않습니다');
  await page.locator('#tab-retro').screenshot({ path: 'out/web/admin-retro-unread-folder.png' });
});

test('a console chip row too wide for the page has arrows, so a mouse reaches every chip', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('cookingfoil:lang', 'ko'); } catch { /* none */ } });
  await page.setViewportSize({ width: 300, height: 800 });
  await page.goto('/#retro');
  const row = page.locator('#retro-systems');
  await expect(row.locator('.chip')).toHaveCount(3);
  const box = page.locator('.hscroll', { has: row });
  const prev = box.locator('.hs-prev'), next = box.locator('.hs-next');
  await expect(prev).toBeHidden();
  await expect(next).toBeVisible();
  await next.click();
  await expect(prev).toBeVisible();
  const last = row.locator('.chip').last();
  await last.click();
  await expect(last).toHaveClass(/active/);
  await expect.poll(() => last.evaluate((el) => {
    const a = el.getBoundingClientRect(), b = el.parentElement!.getBoundingClientRect();
    return a.left >= b.left && a.right <= b.right;
  })).toBe(true);
  await expect(next).toBeHidden();
});

test('a game with achievements says so under its name: gold when its ROM earns them, grey when only its title matched', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('cookingfoil:lang', 'ko'); } catch { /* none */ } });
  const withAch = (g: { name: string }) => ({
    ...g,
    achievements: g.name.includes('시노비')
      ? { raGameId: 1, count: 40, points: 400, matchedBy: 'hash' }
      : { raGameId: 2, count: 12, points: 100, matchedBy: 'title' },
  });
  await page.route(/\/api\/retro\/games(\?|\/[^/?]+(\?|$))/, async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    await route.fulfill({ response: res, json: body.games ? { ...body, games: body.games.map(withAch) } : withAch(body) });
  });
  await page.goto('/#retro');
  const cards = page.locator('#retro-games .game');
  await expect(cards).toHaveCount(2);
  const gold = cards.filter({ hasText: '슈퍼 시노비' }).locator('.pill.ach');
  await expect(gold).toHaveText('업적 40');
  await expect(gold).not.toHaveClass(/title-only/);
  await expect(gold).toHaveAttribute('title', '원본 롬이라 기기에서 업적이 쌓입니다');
  await expect(gold.locator('svg')).toHaveCount(1);
  const grey = cards.filter({ hasNotText: '슈퍼 시노비' }).locator('.pill.ach.title-only');
  await expect(grey).toHaveText('업적 12');
  // It leads the line, so a narrow card never drops it.
  await expect(cards.first().locator('.sub .pill').first()).toHaveClass(/ach/);
  fs.mkdirSync('out/web', { recursive: true });
  await page.screenshot({ path: 'out/web/retro-achievement-pills.png' });

  await cards.filter({ hasText: '슈퍼 시노비' }).click();
  await expect(page.locator('#modal-pills .pill.ach')).toHaveText('업적 40');
  await expect(page.locator('#modal-meta div', { hasText: '업적' }).locator('strong')).toHaveText('40개 · 400점 · 원본 롬이라 기기에서 업적이 쌓입니다');
});

test('a preview shelf keeps its title, game count and buttons on one line, seven cards wide', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/#retro-home');
  const row = page.locator('#retro-rows .home-row:has(.row-count)').first();
  await row.waitFor();
  const mid = (q: string) => row.locator(q).first().evaluate((el) => { const b = el.getBoundingClientRect(); return b.top + b.height / 2; });
  const title = await mid('h2');
  for (const q of ['.row-count', '.row-actions .row-btn']) expect(Math.abs((await mid(q)) - title)).toBeLessThanOrEqual(2);
  expect(await row.evaluate((el) => el.getBoundingClientRect().top)).toBeCloseTo(await row.locator('h2').evaluate((el) => el.getBoundingClientRect().top), 0);
  await expect(row.locator('.recent')).toHaveCSS('--n', '7');
});
