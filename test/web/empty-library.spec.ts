import { test, expect } from '@playwright/test';

test('a server with no games yet says so instead of shimmering forever', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('cookingfoil:lang', 'ko'); } catch { /* none */ } });
  await page.route('**/api/shop/sections', (route) => route.fulfill({ json: { sections: [{ id: 'all', title: 'All', items: [] }], genres: {} } }));
  await page.goto('/');
  const grid = page.locator('#games');
  await expect(grid).toHaveAttribute('aria-busy', 'false');
  await expect(grid.locator('.skel')).toHaveCount(0);
  await expect(grid.locator('.empty strong')).toHaveText('아직 라이브러리에 등록된 게임이 없습니다.');
  await expect(page.locator('#status-text')).toHaveText('구동 중 · 아직 게임이 없습니다');

  await page.getByText('미리보기', { exact: true }).first().click();
  await expect(page.locator('#home-rows .empty strong')).toHaveText('아직 라이브러리에 등록된 게임이 없습니다.');
});
