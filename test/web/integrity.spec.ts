import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { signIn } from './admin-sign-in';

// The file check's notice in the game window: a quiet line for a modified file,
// a butter one for a damaged file, nothing for a clean one. The download stays.
const DETAIL = { id: '0100000000010000', name: 'Test Game', screenshots: [], patches: [] };

async function openGame(page, integrity) {
  await page.addInitScript(() => { try { localStorage.setItem('cookingfoil:lang', 'ko'); } catch { /* none */ } });
  await page.route('**/api/title/0100000000010000?**', (route) => route.fulfill({ json: { ...DETAIL, integrity } }));
  await page.goto('/#all');
  await page.locator('#games .game', { hasText: 'Test Game' }).first().click();
  await expect(page.locator('#modal-title')).toContainText('Test Game');
}

test('a modified base file and a damaged update show their notices, and the download is still offered', async ({ page }) => {
  await openGame(page, [
    { file: 'Test Game [0100000000010000][v0].nsp', kind: 'base', titleId: '0100000000010000', verdict: 'modified' },
    { file: 'Test Game [0100000000010800][v65536].nsp', kind: 'update', titleId: '0100000000010800', verdict: 'damaged' },
  ]);
  const box = page.locator('#modal-integrity');
  await expect(box).toBeVisible();
  const lines = box.locator('p');
  await expect(lines).toHaveCount(2);
  await expect(lines.nth(0)).toHaveText('기본 게임: 수정된 파일입니다. 개조나 한글패치처럼 원본과 다를 수 있습니다.');
  await expect(lines.nth(0)).toHaveClass('modified');
  await expect(lines.nth(1)).toHaveText('업데이트: 손상되었을 수 있는 파일입니다. 설치하거나 실행하지 못할 수 있습니다.');
  await expect(lines.nth(1)).toHaveClass('damaged');
  // Damaged is set apart (butter), modified stays in the quiet secondary colours.
  const bg = (i: number) => lines.nth(i).evaluate((e) => getComputedStyle(e).backgroundColor);
  expect(await bg(0)).not.toBe(await bg(1));
  await expect(page.locator('#modal-download')).toBeVisible();
  fs.mkdirSync('out/web', { recursive: true });
  await page.locator('#modal .modal').screenshot({ path: 'out/web/integrity-notice.png' });
});

test('a file that passed or was not checked shows nothing', async ({ page }) => {
  await openGame(page, []);
  await expect(page.locator('#modal-integrity')).toBeHidden();
});

test('the library tab shows the file check counts and its full hash button', async ({ page }) => {
  // Whether a file is still waiting when the page asks depends on timing, so the waiting state is set here;
  // the counts and the list are the server's own.
  await page.route('**/admin/api/library/verify', async (route) => {
    const res = await route.fetch();
    route.fulfill({ response: res, json: { ...(await res.json()), status: 'tool', pending: 1 } });
  });
  await signIn(page);
  await page.getByRole('link', { name: '게임', exact: true }).click();
  await page.getByRole('tab', { name: '검사' }).click();
  await expect(page.getByRole('heading', { name: '파일 검사' })).toBeVisible();
  await expect(page.locator('#lv-cards .card')).toHaveCount(4);
  await expect(page.locator('#lv-list')).toContainText('수정되거나 손상된 파일이 없습니다.');
  // No nstool: the check says so instead of running.
  await expect(page.locator('#lv-state')).toContainText('nstool 이나 키가 없어');
  await expect(page.getByRole('button', { name: '전체 해시 검사' })).toBeVisible();
});
