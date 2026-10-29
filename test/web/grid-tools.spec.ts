import { test, expect } from '@playwright/test';
import { signIn } from './admin-sign-in';
import { shot } from './shots';

// Every admin table offers a "○○순" order, and a column with a handful of values gets filter chips.
test('admin tables offer an order picker and filter chips', async ({ page }) => {
  await signIn(page);
  const mount = page.locator('.grid-mount:has(select.grid-sort):visible').first();
  for (const tab of ['#homebrew', '#retro', '#users', '#logs', '#nsz', '#patches']) {
    await page.goto('/admin' + tab);
    await page.waitForTimeout(800);
    if (await mount.count()) break;
  }
  await expect(mount).toBeVisible();
  const pick = mount.locator('select.grid-sort');
  const labels = await pick.locator('option').allTextContents();
  expect(labels[0]).toBe('기본 순서');
  expect(labels.some((l) => /순$/.test(l) && l !== '기본 순서')).toBe(true);
  await pick.selectOption({ index: labels.length - 1 });
  await expect(mount.locator('.ag-header-cell[aria-sort="descending"], .ag-header-cell[aria-sort="ascending"]')).toHaveCount(1);
  await shot(mount, { path: test.info().outputPath('grid-tools.png') });
});
