import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { signIn } from './admin-sign-in';

// The file browser on real folders: open a folder, come back by the path, make a
// folder, rename, move a selection into another folder and send one to the trash.
const games = process.env.COOK_GAMES_DIR!;
const base = path.join(games, 'fb-test');
const put = (rel: string, body = 'x') => {
  fs.mkdirSync(path.dirname(path.join(base, rel)), { recursive: true });
  fs.writeFileSync(path.join(base, rel), body);
};
const has = (rel: string) => fs.existsSync(path.join(base, rel));
const row = (page: import('@playwright/test').Page, name: string) => page.locator('#fb-rows tr', { has: page.getByText(name, { exact: true }) });

test.beforeEach(() => {
  fs.rmSync(base, { recursive: true, force: true });
  put('Alpha/one.nsp', '1');
  put('Alpha/two.nsp', '22');
  put('Beta/keep.txt');
  put('loose.nsp', '333');
});
test.afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

test('a folder opens, the path leads back, and the address keeps the place', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin/games?tab=folder&path=fb-test');
  await expect(row(page, 'Alpha')).toBeVisible();
  await expect(row(page, 'loose.nsp')).toContainText('3 B');
  await row(page, 'Alpha').getByRole('button', { name: 'Alpha' }).click();
  await expect(page).toHaveURL(/path=fb-test%2FAlpha|path=fb-test\/Alpha/);
  await expect(row(page, 'one.nsp')).toBeVisible();
  await page.locator('#fb-crumb').getByRole('button', { name: 'fb-test' }).click();
  await expect(row(page, 'Beta')).toBeVisible();
  await page.goBack();
  await expect(row(page, 'two.nsp')).toBeVisible();
});

test('a new folder, a rename, a move and a trash each change the disk', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin/games?tab=folder&path=fb-test');
  await expect(row(page, 'Alpha')).toBeVisible();

  await page.locator('#fb-mkdir').click();
  await page.locator('#ask-input').fill('Gamma');
  await page.locator('#ask-ok').click();
  await expect(row(page, 'Gamma')).toBeVisible();
  expect(fs.statSync(path.join(base, 'Gamma')).isDirectory()).toBe(true);

  await row(page, 'loose.nsp').getByRole('button', { name: '이름 바꾸기' }).click();
  await page.locator('#ask-input').fill('renamed.nsp');
  await page.locator('#ask-ok').click();
  await expect(row(page, 'renamed.nsp')).toBeVisible();
  expect(has('renamed.nsp') && !has('loose.nsp')).toBe(true);

  await row(page, 'renamed.nsp').locator('input[type=checkbox]').check();
  await row(page, 'Beta').locator('input[type=checkbox]').check();
  await expect(page.locator('#fb-info')).toHaveText('2개를 골랐습니다');
  await page.locator('#fb-move-btn').click();
  await page.locator('#fb-m-list').getByRole('button', { name: 'Gamma' }).click();
  await expect(page.locator('#fb-m-crumb')).toContainText('Gamma');
  await page.locator('#fb-m-ok').click();
  await expect(page.locator('#toast')).toContainText('2개를 옮겼습니다');
  expect(has('Gamma/renamed.nsp') && has('Gamma/Beta/keep.txt')).toBe(true);
  await expect(row(page, 'Beta')).toHaveCount(0);

  await row(page, 'Alpha').getByRole('button', { name: '휴지통으로' }).click();
  await page.locator('#ask-ok').click();
  await expect(row(page, 'Alpha')).toHaveCount(0);
  expect(has('Alpha')).toBe(false);
});

test('the header row stays in view while the list scrolls, and the bar sits at the bottom', async ({ page }) => {
  for (let i = 0; i < 60; i++) put(`Many/file-${String(i).padStart(2, '0')}.nsp`);
  await page.setViewportSize({ width: 1280, height: 720 });
  await signIn(page);
  await page.goto('/admin/games?tab=folder&path=fb-test%2FMany');
  await expect(row(page, 'file-59.nsp')).toBeVisible();
  await page.mouse.wheel(0, 1500);
  const head = await page.locator('#fb thead th.c-name').boundingBox();
  const bar = await page.locator('#fb-foot').boundingBox();
  expect(head!.y).toBeGreaterThanOrEqual(60);
  expect(head!.y).toBeLessThan(80);
  expect(Math.round(bar!.y + bar!.height)).toBe(720);
  if (process.env.FB_SHOTS) await page.screenshot({ path: path.join(process.env.FB_SHOTS, 'files-desktop.png') });
});

test('on a phone the list fits the width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await page.goto('/admin/games?tab=folder&path=fb-test');
  await expect(row(page, 'Alpha')).toBeVisible();
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(390);
  if (process.env.FB_SHOTS) await page.screenshot({ path: path.join(process.env.FB_SHOTS, 'files-phone.png') });
});

test('files dropped on the list or picked with Upload land in the open folder, in pieces', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin/games?tab=folder&path=fb-test%2FBeta');
  await expect(row(page, 'keep.txt')).toBeVisible();
  await page.evaluate(() => { (window as any).UP_CHUNK_BYTES = 4; });

  await page.locator('#fb-file').setInputFiles([{ name: 'picked.nsp', mimeType: 'application/octet-stream', buffer: Buffer.from('0123456789') }]);
  await expect(page.locator('#toast')).toContainText('1개를 올렸습니다');
  await expect(row(page, 'picked.nsp')).toBeVisible();
  expect(fs.readFileSync(path.join(base, 'Beta/picked.nsp'), 'utf8')).toBe('0123456789');

  const drop = await page.evaluateHandle(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['dropped bytes'], 'dropped.nsp'));
    dt.items.add(new File(['NEW'], 'keep.txt'));
    return dt;
  });
  await page.locator('#fb .fb-wrap').dispatchEvent('dragenter', { dataTransfer: drop });
  await expect(page.locator('#fb')).toHaveClass(/dragging/);
  await page.locator('#fb .fb-wrap').dispatchEvent('drop', { dataTransfer: drop });
  await expect(page.locator('#toast')).toContainText('1개를 올렸습니다. 1개는 같은 이름이 이미 있어 건너뛰었습니다');
  await expect(page.locator('#fb')).not.toHaveClass(/dragging/);
  expect(fs.readFileSync(path.join(base, 'Beta/dropped.nsp'), 'utf8')).toBe('dropped bytes');
  expect(fs.readFileSync(path.join(base, 'Beta/keep.txt'), 'utf8')).toBe('x');
});
