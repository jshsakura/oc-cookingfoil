import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { signIn } from './admin-sign-in';

// The file browser in a phone's hand: nothing here needs a hover, a double click or a right click.
const games = process.env.COOK_GAMES_DIR!;
const base = path.join(games, 'fb-phone');
const put = (rel: string, body = 'x') => {
  fs.mkdirSync(path.dirname(path.join(base, rel)), { recursive: true });
  fs.writeFileSync(path.join(base, rel), body);
};
const has = (rel: string) => fs.existsSync(path.join(base, rel));
const row = (page: import('@playwright/test').Page, name: string) => page.locator('#fb-rows tr', { has: page.getByText(name, { exact: true }) });
const LONG = 'A Game With A Rather Long Name Indeed.nsp';

test.beforeEach(async ({ page }) => {
  fs.rmSync(base, { recursive: true, force: true });
  put('Alpha/one.nsp', '1');
  put('Beta/keep.txt', 'hello');
  put('loose.nsp', '333');
  put(LONG, '4444');
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await page.goto('/admin/games?tab=folder&path=fb-phone');
  await expect(row(page, 'Alpha')).toBeVisible();
});
test.afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

test('a tap opens a folder, previews what can be previewed, and only picks a game file', async ({ page }) => {
  let downloads = 0;
  page.on('download', () => { downloads++; });
  await row(page, 'Alpha').click({ position: { x: 120, y: 10 } });
  await expect(row(page, 'one.nsp')).toBeVisible();
  await page.locator('#fb-upb').click();
  await row(page, 'Beta').click({ position: { x: 120, y: 10 } });
  await row(page, 'keep.txt').click({ position: { x: 120, y: 10 } });
  await expect(page.locator('#fb-view')).toBeVisible();
  await page.locator('#fb-v-x').click();
  await page.locator('#fb-upb').click();
  await row(page, 'loose.nsp').dblclick({ position: { x: 120, y: 10 } });
  await row(page, 'loose.nsp').click({ position: { x: 120, y: 10 } });
  await expect(row(page, 'loose.nsp')).toHaveAttribute('aria-selected', 'true');
  expect(downloads).toBe(0);
});

test('with a pick held a tap adds or takes away instead of opening', async ({ page }) => {
  await row(page, 'loose.nsp').click({ position: { x: 120, y: 10 } });
  await row(page, 'Alpha').click({ position: { x: 120, y: 10 } });
  await expect(row(page, 'Alpha')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#fb-info')).toHaveText('2개를 골랐습니다');
  await row(page, 'Alpha').click({ position: { x: 120, y: 10 } });
  await expect(row(page, 'Alpha')).toHaveAttribute('aria-selected', 'false');
});

test('a pick shows what it allows in words at the bottom, and 파일 메뉴 holds the rest', async ({ page }) => {
  await row(page, 'Alpha').locator('input[type=checkbox]').check();
  const bar = page.locator('#fb-pick-acts');
  await expect(bar.getByRole('button')).toHaveText(['zip으로 내려받기', '이름 바꾸기', '이동', '휴지통으로', '파일 메뉴']);
  const box = (await bar.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(844);
  for (const b of await bar.getByRole('button').all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.locator('#fb-clear').click();
  await expect(bar.getByRole('button')).toHaveCount(0);

  await row(page, 'loose.nsp').click({ position: { x: 120, y: 10 } });
  await expect(bar.getByRole('button')).toHaveText(['내려받기', '이름 바꾸기', '이동', '휴지통으로', '파일 메뉴']);
  await bar.getByRole('button', { name: '파일 메뉴' }).click();
  const menu = page.locator('#fb-menu');
  await expect(menu.getByRole('menuitem', { name: '파일 압축' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: '파일 검사' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: '속성' })).toBeVisible();
  const sheet = (await menu.boundingBox())!;
  expect(sheet.x).toBe(0);
  expect(sheet.width).toBe(390);
  expect(sheet.y + sheet.height).toBeCloseTo(844, 0);
});

test('the bar above the list keeps to what works here', async ({ page }) => {
  for (const id of ['fb-t-tree', 'fb-t-side', 'fb-back', 'fb-fwd', 'fb-cut-btn', 'fb-copy-btn', 'fb-rename-btn', 'fb-move-btn', 'fb-zip-btn', 'fb-share-btn', 'fb-trash-btn', 'fb-paste-btn', 'fb-undo-btn']) {
    await expect(page.locator('#' + id), id).toBeHidden();
  }
  await expect(page.locator('#fb-mkdir')).toHaveText('새 폴더');
  await expect(page.locator('#fb-tidy-btn')).toHaveText('정리');
  const above = await page.evaluate(() => document.getElementById('fb-main')!.getBoundingClientRect().top - document.getElementById('fb')!.getBoundingClientRect().top);
  expect(above).toBeLessThan(170);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('tiles show their check box untouched, and it picks without opening', async ({ page }) => {
  await page.locator('#fb-v-grid').click();
  const cb = row(page, 'Alpha').locator('input[type=checkbox]');
  await expect(cb).toBeVisible();
  expect(await cb.evaluate((n) => getComputedStyle(n.closest('td')!).opacity)).toBe('1');
  await cb.check();
  await expect(row(page, 'Alpha')).toHaveAttribute('aria-selected', 'true');
  await expect(row(page, 'loose.nsp')).toBeVisible();
  await page.locator('#fb-clear').click();
  await page.locator('#fb-v-list').click();
});

test('a cut lets go of the pick, so a tap walks to the folder and paste shows there', async ({ page }) => {
  await row(page, 'loose.nsp').click({ position: { x: 120, y: 10 } });
  await page.getByRole('button', { name: '파일 메뉴' }).click();
  await page.locator('#fb-menu').getByRole('menuitem', { name: '잘라내기' }).click();
  await expect(page.locator('#fb-info')).not.toHaveText(/골랐습니다/);
  await row(page, 'Alpha').click({ position: { x: 120, y: 10 } });
  await expect(row(page, 'one.nsp')).toBeVisible();
  await page.locator('#fb-paste-btn').click();
  await expect(row(page, 'loose.nsp')).toBeVisible();
  expect(has('Alpha/loose.nsp')).toBe(true);
});

test('walking away drops the bar at once, before the next folder has loaded', async ({ page }) => {
  await row(page, 'loose.nsp').click({ position: { x: 120, y: 10 } });
  await expect(page.locator('#fb-pick-acts').getByRole('button')).toHaveCount(5);
  await page.route('**/admin/api/files**', async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  await page.locator('#fb-upb').click();
  await expect(page.locator('#fb-pick-acts').getByRole('button')).toHaveCount(0, { timeout: 500 });
  await page.unroute('**/admin/api/files**');
});

test('a details pane left on from a wide screen does not take the row buttons at tablet width', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('fb.side', '1'));
  await page.setViewportSize({ width: 820, height: 900 });
  await page.reload();
  await expect(row(page, 'Alpha')).toBeVisible();
  await expect(page.locator('#fb')).toHaveClass(/side-on/);
  await expect(row(page, 'Alpha').locator('.c-act')).toBeVisible();
});

test('turning the phone drops the row dragging with the desktop layout', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.reload();
  await expect(row(page, 'Alpha')).toHaveAttribute('draggable', 'true');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(row(page, 'Alpha')).toHaveAttribute('draggable', 'false');
});

test('a long name reads across the row, with no row buttons beside it', async ({ page }) => {
  const name = row(page, LONG).locator('.fb-name > span').first();
  expect((await name.boundingBox())!.width).toBeGreaterThan(180);
  await expect(row(page, LONG).locator('.c-act')).toBeHidden();
});

test('the header says which page this is, not only 파일', async ({ page }) => {
  await expect(page.locator('#adm-crumb .adm-crumb-g').filter({ hasText: '게임' })).toBeVisible();
  await expect(page.locator('#adm-crumb .adm-crumb-i')).toHaveText('파일');
});
