import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { signIn } from './admin-sign-in';

const ID = '0100000000010000';
const SHOTS = process.env.COOK_SHOT_DIR ?? 'out/web';

// The home picks row finds a game as you type, by part of its Korean name, and adds it from the keyboard.
test('typing part of a Korean name in a home picks row and pressing Enter adds that game', async ({ page }) => {
  const cookie = await signIn(page);
  const origin = new URL(page.url()).origin;
  const headers = { Cookie: cookie, Origin: origin };
  // The admin's Korean name for the test game, so the search has a Korean name to match.
  expect((await page.request.post(`/admin/api/descriptions/${ID}`, { data: { name: { ko: '시험용 게임', en: '' } }, headers })).ok()).toBe(true);
  try {
    const found = await (await page.request.get('/admin/api/games/search?q=' + encodeURIComponent('ㅅㅎㅇ'), { headers })).json();
    expect(found.items.map((g: { titleId: string }) => g.titleId)).toContain(ID);

    await page.getByRole('link', { name: '파일·정리', exact: true }).click();
    await page.getByRole('link', { name: '홈 추천' }).click();
    await page.getByRole('button', { name: '추천 줄 추가', exact: true }).click();
    const search = page.getByRole('combobox', { name: '추가할 게임' });
    await search.pressSequentially('시험');
    const option = page.getByRole('option', { name: new RegExp(ID) });
    await expect(option).toBeVisible();
    await expect(search).toHaveAttribute('aria-expanded', 'true');
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/game-picker-open.png` });
    await search.press('ArrowDown');
    await search.press('ArrowUp');
    await search.press('Enter');

    const row = page.locator('#f-list .fgames');
    await expect(row.locator('li')).toHaveCount(1);
    await expect(row).toContainText(/시험용 게임|Test Game/);
    // The same row's search keeps the focus; the game already there is marked and not added twice.
    const again = page.getByRole('combobox', { name: '추가할 게임' });
    await expect(again).toBeFocused();
    await again.pressSequentially(ID.slice(-8));
    await expect(page.getByRole('option', { name: new RegExp(ID) })).toHaveAttribute('aria-disabled', 'true');
    await page.screenshot({ path: `${SHOTS}/game-picker-added.png` });
    await again.press('Enter');
    await expect(row.locator('li')).toHaveCount(1);
    await again.press('Escape');
    await expect(again).toHaveAttribute('aria-expanded', 'false');

    // At phone width the list stays as wide as the field and inside the window.
    await page.setViewportSize({ width: 390, height: 760 });
    await again.fill('');
    await again.pressSequentially('시험');
    const list = page.getByRole('listbox');
    await expect(list).toBeVisible();
    const [field, box] = [await again.boundingBox(), await list.boundingBox()];
    expect(Math.abs(box!.width - field!.width)).toBeLessThan(2);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    await page.screenshot({ path: `${SHOTS}/game-picker-phone.png` });
  } finally {
    await page.request.post(`/admin/api/descriptions/${ID}/reset`, { data: { field: 'name' }, headers });
  }
});
