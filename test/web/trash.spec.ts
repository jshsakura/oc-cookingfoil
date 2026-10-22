import { test, expect } from '@playwright/test';
import { signIn } from './admin-sign-in';
import fs from 'node:fs';
import path from 'node:path';

// The admin page's 휴지통 tab against the real server: a file removed from the
// library shows there with where it came from, comes back with 되돌리기, and
// goes for good only after the person types the word to empty it.
const GAMES = process.env.COOK_GAMES_DIR!;
const NAME = 'Trash Game [0100000000040000][v0].nsp';
const FILE = path.join(GAMES, NAME);

// Other specs remove files on the same server, so each test starts from an empty trash.
const emptyAll = async (page: import('@playwright/test').Page) => {
  const { version } = await (await page.request.get('/admin/api/trash')).json().catch(() => ({}));
  await page.request.post('/admin/api/trash/empty', { data: { all: true, version, confirm: 'empty' } }).catch(() => {});
};

test.afterEach(async ({ page }) => {
  fs.rmSync(FILE, { force: true });
  await emptyAll(page);
});

async function removeFromLibrary(page: import('@playwright/test').Page) {
  fs.writeFileSync(FILE, 'TRASH ME');
  await expect.poll(async () => (await (await page.request.post('/admin/api/library/files/remove', { data: { rel: NAME } })).status()), { timeout: 15000 }).toBe(200);
  expect(fs.existsSync(FILE)).toBe(false);
}

test('a removed file is listed in the trash and comes back with 되돌리기', async ({ page }) => {
  await signIn(page);
  await emptyAll(page);
  await removeFromLibrary(page);
  await page.goto('/admin#trash');
  const row = page.locator('#tr-list .tr-row', { hasText: NAME });
  await expect(row).toBeVisible();
  await expect(row).toContainText('원래 자리: 게임 / ' + NAME);
  await expect(row).toContainText('파일 삭제');
  await expect(page.locator('#tr-cards')).toContainText('게임');
  await row.getByRole('button', { name: '되돌리기' }).click();
  await expect(page.locator('#toast')).toContainText('1개를 되돌렸습니다');
  await expect(page.locator('#tr-list')).toContainText('휴지통이 비어 있습니다');
  expect(fs.readFileSync(FILE, 'utf8')).toBe('TRASH ME');
});

test('emptying asks for the word: a wrong one keeps everything, the right one deletes for good', async ({ page }) => {
  await signIn(page);
  await emptyAll(page);
  await removeFromLibrary(page);
  await page.goto('/admin#trash');
  const row = page.locator('#tr-list .tr-row', { hasText: NAME });
  await expect(row).toBeVisible();

  await row.getByRole('button', { name: '비우기' }).click();
  await expect(page.locator('#ask-text')).toContainText('되돌릴 수 없습니다');
  await page.locator('#ask-input').fill('아니요');
  await page.locator('#ask-ok').click();
  await expect(page.locator('#toast')).toContainText('비우지 않았습니다');
  await expect(row).toBeVisible();

  await row.locator('input[type=checkbox]').check();
  await page.locator('#tr-empty-sel').click();
  await page.locator('#ask-input').fill('비우기');
  await page.locator('#ask-ok').click();
  await expect(page.locator('#toast')).toContainText('1개를 지워');
  await expect(page.locator('#tr-list')).toContainText('휴지통이 비어 있습니다');
  const listed = await (await page.request.get('/admin/api/trash')).json();
  expect(listed.total.count).toBe(0);
  expect(fs.existsSync(FILE)).toBe(false);
});

test('emptying everything refuses when an entry came in after the list was shown', async ({ page }) => {
  await signIn(page);
  await emptyAll(page);
  await removeFromLibrary(page);
  await page.goto('/admin#trash');
  await expect(page.locator('#tr-list .tr-row', { hasText: NAME })).toBeVisible();
  // Something lands in the trash while the page is open (the NSZ queue does this).
  const LATE = 'Late Game [0100000000050000][v0].nsp';
  fs.writeFileSync(path.join(GAMES, LATE), 'LATE');
  await expect.poll(async () => (await (await page.request.post('/admin/api/library/files/remove', { data: { rel: LATE } })).status()), { timeout: 15000 }).toBe(200);
  await page.locator('#tr-empty-all').click();
  await page.locator('#ask-input').fill('비우기');
  await page.locator('#ask-ok').click();
  await expect(page.locator('#toast')).toContainText('그사이 바뀌었습니다');
  const listed = await (await page.request.get('/admin/api/trash')).json();
  expect(listed.total.count).toBe(2);
});

test('the trash tab speaks the language the top area is set to', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin#trash');
  await page.locator('#lang-btn').click();
  await page.locator('[data-admin-lang="en"]').click();
  await expect(page.locator('#tab-trash h2').first()).toHaveText('Trash');
  await expect(page.locator('#tr-empty-all')).toHaveText('Empty trash');
  await page.locator('#lang-btn').click();
  await page.locator('[data-admin-lang="ko"]').click();
  await expect(page.locator('#tab-trash h2').first()).toHaveText('휴지통');
});
