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
  await expect(bar.getByRole('button')).toHaveText(['올리기', '파일 메뉴']);

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
  await expect(page.locator('#fb-mkdir')).toBeHidden();
  await expect(page.locator('#fb-tidy-btn')).toBeHidden();
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
  await page.locator('#fb-pick-acts').getByRole('button', { name: '붙여넣기' }).click();
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
  await expect(page.locator('#fb-pick-acts').getByRole('button')).toHaveCount(2, { timeout: 500 });
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

test('a long notice reads across the screen, with its undo inside it', async ({ page }) => {
  await page.evaluate(() => (window as any).fbToastUndo('2개를 옮겼습니다. 다른 게임이 들어 있는 폴더입니다. 게임이 섞이지 않았는지 확인해 주세요.'));
  const box = await page.locator('#toast').boundingBox();
  expect(box!.width).toBeGreaterThan(300);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await expect(page.locator('#toast .toast-act')).toBeVisible();
});

test('a finished upload offers only its close button, inside the screen', async ({ page }) => {
  await page.locator('#fb-file').setInputFiles([{ name: 'small.nsp', mimeType: 'application/octet-stream', buffer: Buffer.from('bytes') }]);
  await expect(row(page, 'small.nsp')).toBeVisible();
  await expect(page.locator('#fb-up-stop')).toBeHidden();
  const close = await page.locator('#fb-up-close').boundingBox();
  expect(close!.x + close!.width).toBeLessThanOrEqual(390);
});

test('properties of one game file say which game and version it is, as the details pane does', async ({ page }) => {
  const name = 'Hollow Game [0100000000010002][v65536].nsp';
  put(name, '55');
  await page.route('**/admin/api/files/list?*', async (route) => {
    const res = await route.fetch();
    const json = await res.json();
    for (const f of json.items) if (f.name === name) Object.assign(f, { titleId: '0100000000010000', kind: 'update', version: 65536, check: 'damaged', why: { label: '손상됨', certain: true, help: { title: '파일이 잘렸습니다', body: '받다가 끊긴 파일입니다.' } } });
    await route.fulfill({ response: res, json });
  });
  await page.locator('#fb-refresh').click();
  await row(page, name).click({ position: { x: 120, y: 10 } });
  await page.locator('#fb-pick-acts').getByRole('button', { name: '파일 메뉴' }).click();
  await page.locator('#fb-menu').getByRole('menuitem', { name: '속성' }).click();
  const dlg = page.locator('#fb-props');
  await expect(dlg).toBeVisible();
  await expect(dlg.locator('#fb-p-list')).toContainText('0100000000010000');
  await expect(dlg.locator('#fb-p-list')).toContainText('v65536');
  await expect(dlg.locator('#fb-p-list')).toContainText('위치');
  await expect(dlg.locator('.fb-s-head h4')).toHaveText(name);
  await expect(dlg.locator('.fb-s-badges')).toContainText('업데이트 v65536');
  await expect(dlg.locator('.fb-s-why')).toContainText('파일이 잘렸습니다');
  const art = await dlg.locator('.fb-s-head > :first-child').boundingBox();
  expect(art!.width).toBeLessThanOrEqual(96);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('a search that finds nothing here looks in the folders below, says so, and walks to a find', async ({ page }) => {
  await page.locator('#fb-q').fill('one.nsp');
  await expect(row(page, 'one.nsp')).toBeVisible();
  await expect(page.locator('#fb-deep')).toBeChecked();
  await expect(page.locator('#toast')).toContainText('하위 폴더까지');
  await page.locator('#fb-q').fill('');
  await expect(row(page, 'Alpha')).toBeVisible();
  await expect(page.locator('#fb-deep')).not.toBeChecked();

  await page.locator('#fb-q').fill('nowhere-at-all');
  await expect(page.locator('#fb-empty')).toHaveText('찾는 이름이 이 폴더와 하위 폴더에 없습니다.');

  await page.locator('#fb-q').fill('one.nsp');
  await row(page, 'one.nsp').locator('.fb-at').click();
  await expect(page).toHaveURL(/path=fb-phone%2FAlpha/);
  await expect(page.locator('#fb-q')).toHaveValue('');
  await expect(row(page, 'one.nsp')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#fb-info')).toHaveText('1개를 골랐습니다');
});

test('a search turned back to this folder by hand stays there', async ({ page }) => {
  await page.locator('#fb-q').fill('one.nsp');
  await expect(page.locator('#fb-deep')).toBeChecked();
  await page.locator('#fb-deep').uncheck();
  await expect(page.locator('#fb-empty')).toHaveText('찾는 이름이 이 폴더에 없습니다');
  await expect(page.locator('#fb-deep')).not.toBeChecked();
});

test('with nothing picked the bottom edge offers upload and 파일 메뉴, which holds the rest', async ({ page }) => {
  const bar = page.locator('#fb-pick-acts');
  await expect(bar.getByRole('button')).toHaveText(['올리기', '파일 메뉴']);
  for (const b of await bar.getByRole('button').all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expect(page.locator('#fb-foot .fb-sel-act')).toBeHidden();
  await bar.getByRole('button', { name: '파일 메뉴' }).click();
  const menu = page.locator('#fb-menu');
  for (const name of ['새 폴더', '올리기', '폴더 올리기', '정리', '다시 스캔', '속성']) await expect(menu.getByRole('menuitem', { name, exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  const first = await page.locator('#fb-rows tr').first().boundingBox();
  expect(first!.y).toBeLessThan(290);
  const foot = (await page.locator('#fb-foot').boundingBox())!;
  expect(foot.height).toBeLessThan(72);
  expect(foot.y + foot.height).toBeCloseTo(844, 0);
  expect(foot.x).toBe(0);
  expect(foot.width).toBe(390);
});

test('전부 beside the count picks the whole list and lets it all go again', async ({ page }) => {
  await row(page, 'loose.nsp').click({ position: { x: 120, y: 10 } });
  const all = page.locator('#fb-pick-all');
  await all.click();
  await expect(page.locator('#fb-info')).toHaveText('4개를 골랐습니다');
  await all.click();
  await expect(page.locator('#fb-info')).not.toHaveText(/골랐습니다/);
  await expect(page.locator('#fb-pick-acts').getByRole('button')).toHaveText(['올리기', '파일 메뉴']);
  await row(page, 'loose.nsp').click({ position: { x: 120, y: 10 } });
  await page.locator('#fb-pick-acts').getByRole('button', { name: '파일 메뉴' }).click();
  await expect(page.locator('#fb-menu').getByRole('menuitem', { name: '이 페이지를 전부 고릅니다' })).toHaveCount(0);
});
