import { test, expect } from '@playwright/test';
import { signIn } from './admin-sign-in';

test('the sidebar has a 패치 page that opens the game patches, and its upload button starts a patch upload', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin/patches');
  await expect(page.locator('a.adm-item[href="/admin/patches"]').first()).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#lib-patches .pt-row', { hasText: '게임 데이터' })).toBeVisible();
  await page.getByRole('button', { name: '패치 올리기' }).click();
  await expect(page).toHaveURL(/\/admin\/upload\?kind=patch/);
  await expect(page.locator('#up-hint')).toContainText('atmosphere/contents');
});

test('the library and patch pages open without a script error or a failed-load toast', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await signIn(page);
  for (const path of ['/admin/games', '/admin/patches']) {
    await page.goto(path);
    await expect(page.locator('#lib-patches, #lib-cards').first()).toBeAttached();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('#toast')).not.toContainText('is not defined');
  }
  expect(errors).toEqual([]);
});
