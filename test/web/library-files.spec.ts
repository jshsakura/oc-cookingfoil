import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import { signIn } from './admin-sign-in';

// The library tab's file browser: a tab per kind with its count, a page of 50
// at a time, and a search that stays inside the chosen kind.
const GAMES = '/tmp/cookingfoil-web-test-games';
const EXTRA = `${GAMES}/zz-e2e-extras`;


test('the library tab lists files by kind with counts, pages and a search inside the kind', async ({ page, request }) => {
  // 55 stray files: not game files, so the shop list stays as it is.
  fs.rmSync(EXTRA, { recursive: true, force: true });
  fs.mkdirSync(EXTRA, { recursive: true });
  for (let i = 0; i < 55; i++) fs.writeFileSync(`${EXTRA}/note-${String(i).padStart(2, '0')}.txt`, 'x'.repeat(i + 1));
  try {
    await signIn(page);
    const cookie = (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; ');
    // A rescan also drops the cached list of stray files.
    await request.post('/admin/api/library/rescan', { headers: { Cookie: cookie }, data: {} });
    await expect.poll(async () => (await (await request.get('/admin/api/library/browse?counts_only=1', { headers: { Cookie: cookie } })).json()).counts?.other, { timeout: 15000 }).toBeGreaterThanOrEqual(55);

    await page.goto('/admin#library');
    const tabs = page.locator('#lb-kinds [role=tab]');
    await expect(tabs).toHaveText([/게임/, /업데이트/, /DLC/, /패치/, /세이브/, /홈브류/, /기타/]);
    await expect(page.locator('#lb-tab-base')).toHaveAttribute('aria-selected', 'true');
    // Other specs may add a game for a moment (the games folder is shared): at least the one fixture.
    await expect(page.locator('#lb-n-base')).not.toHaveText('0');
    await expect(page.locator('#lb-list')).toContainText('Test Game');
    await expect(page.locator('#lb-n-patch')).not.toHaveText('0');
    await expect(page.locator('#lb-n-other')).not.toHaveText('0');
    // Every button in the browser carries an icon.
    for (const b of await page.locator('#lib-files button').all()) await expect(b.locator('svg')).toHaveCount(1);

    fs.mkdirSync('out/web', { recursive: true });
    await page.locator('#lb-tab-patch').click();
    await expect(page.locator('#lb-tab-patch')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#lb-list')).toContainText('게임 데이터');
    await expect(page.locator('#lb-list')).not.toContainText('Test Game');

    await page.locator('#lb-tab-other').click();
    await expect(page.locator('#lb-list tr', { hasText: 'note-' })).toHaveCount(50);
    await expect(page.locator('#lb-pager')).toBeVisible();
    await expect(page.locator('#lb-count')).toContainText('1에서 50번째');
    await page.getByRole('button', { name: '다음 페이지' }).click();
    await expect(page.locator('#lb-pager [aria-current=page]')).toHaveText('2');
    await expect(page.locator('#lb-list')).toContainText('note-54.txt');
    await page.getByRole('button', { name: '이전 페이지' }).click();
    await expect(page.locator('#lb-pager [aria-current=page]')).toHaveText('1');

    // Biggest first.
    await page.locator('#lb-sort').selectOption('size');
    await expect(page.locator('#lb-list tr').nth(1)).toContainText('note-54.txt');

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ colorScheme: 'light' });
    await page.locator('#lib-files').screenshot({ path: 'out/web/library-files-1280-light.png', animations: 'disabled' });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.locator('#lib-files').screenshot({ path: 'out/web/library-files-1280-dark.png', animations: 'disabled' });

    // The search stays inside the kind: a game name finds nothing among the stray files.
    await page.locator('#lb-q').fill('Test Game');
    await page.locator('#lb-go').click();
    await expect(page.locator('#lb-list')).toContainText('이 종류에는 맞는 파일이 없습니다.');
    await expect(page.locator('#lb-n-base')).not.toHaveText('0');
    await expect(page.locator('#lb-n-other')).toHaveText('0');
    await expect(page.locator('#lb-pager')).toBeHidden();
    await page.locator('#lb-q').fill('note-07');
    await page.locator('#lb-go').click();
    await expect(page.locator('#lb-list tr', { hasText: 'note-' })).toHaveCount(1);
    await expect(page.locator('#lb-n-other')).toHaveText('1');

    await page.locator('#lb-q').fill('');
    await page.locator('#lb-go').click();
    await page.locator('#lb-sort').selectOption('name');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('#lb-list tr', { hasText: 'note-' })).toHaveCount(50);
    await page.emulateMedia({ colorScheme: 'light' });
    await page.locator('#lib-files').screenshot({ path: 'out/web/library-files-390-light.png', animations: 'disabled' });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.locator('#lib-files').screenshot({ path: 'out/web/library-files-390-dark.png', animations: 'disabled' });
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width).toBeLessThanOrEqual(390);
  } finally {
    fs.rmSync(EXTRA, { recursive: true, force: true });
  }
});
