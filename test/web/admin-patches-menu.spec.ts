import { test, expect } from '@playwright/test';
import { signIn } from './admin-sign-in';

test('the patches page lists the game patches, and its upload button starts a patch upload', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin/patches?tab=list');
  await expect(page.locator('#patches-subtabs [data-sub="list"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#lib-patches .pt-row', { hasText: '게임 데이터' })).toBeVisible();
  await page.getByRole('button', { name: '패치 올리기' }).click();
  await expect(page).toHaveURL(/\/admin\/upload\?kind=patch/);
  await expect(page.locator('#up-hint')).toContainText('atmosphere/contents');
});

test('the library and patch pages open without a script error or a failed-load toast', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await signIn(page);
  for (const path of ['/admin/games', '/admin/patches', '/admin/saves']) {
    await page.goto(path);
    await expect(page.locator('#lib-patches, #lib-saves, #lib-cards').first()).toBeAttached();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('#toast')).not.toContainText('is not defined');
  }
  expect(errors).toEqual([]);
});

test('on a phone a patch row puts its name on a line of its own and the game title stays inside the card', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await page.goto('/admin/patches?tab=list');
  const row = page.locator('#lib-patches .pt-row', { hasText: '게임 데이터' });
  await expect(row).toBeVisible();
  const [rowBox, nameBox, editBox] = await Promise.all([row.boundingBox(), row.locator('.pt-name').boundingBox(), row.locator('.pt-edit').boundingBox()]);
  expect(nameBox!.width).toBeGreaterThan(rowBox!.width * 0.9);
  expect(editBox!.y).toBeGreaterThan(nameBox!.y + nameBox!.height - 1);
  const card = page.locator('#lib-patches .pt-game').first();
  const title = card.locator('header b');
  const [cardBox, titleBox] = await Promise.all([card.boundingBox(), title.boundingBox()]);
  expect(titleBox!.x + titleBox!.width).toBeLessThanOrEqual(cardBox!.x + cardBox!.width);
});
