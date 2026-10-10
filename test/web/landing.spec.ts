import { test, expect } from '@playwright/test';
import fs from 'node:fs';

test('landing follows the system theme until the visitor picks one, then remembers it', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  const root = page.locator('html');
  await expect(root).not.toHaveAttribute('data-theme', /.+/);
  const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(await background()).toBe('rgb(242, 241, 238)');

  await expect(page.locator('[data-theme-choice="light"]')).toHaveClass(/active/);
  await page.locator('[data-theme-choice="dark"]').click();
  await expect(root).toHaveAttribute('data-theme', 'dark');
  expect(await background()).toBe('rgb(22, 22, 26)');

  await page.reload();
  await expect(root).toHaveAttribute('data-theme', 'dark');
  fs.mkdirSync('out/web', { recursive: true });
  await page.screenshot({ path: 'out/web/landing-dark.png' });
});

test('landing names the shop, shows its status and links to the admin page', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'CookingFoil', exact: true })).toBeVisible();
  await expect(page.locator('#status-text')).not.toHaveClass(/sk/);
  await expect(page.locator('a.admin-link')).toHaveAttribute('href', '/admin');
});

test('genre chips filter the library by English key and follow the page language', async ({ page }) => {
  await page.route('**/api/shop/sections', (route) => route.fulfill({
    json: {
      sections: [{ id: 'all', title: 'All', items: [{ app_type: 'base', title_id: '0100000000010000', categories: ['Party'] }] }],
      genres: { Party: { en: 'Party', ko: '파티', ja: 'パーティー', zh: '派對' } },
    },
  }));
  await page.goto('/');
  await page.locator('.lang-toggle [data-lang="ko"]').click();
  const party = page.locator('#genre-chips [data-genre="Party"]');
  await expect(party).toContainText('파티');
  await page.locator('.lang-toggle [data-lang="en"]').click();
  await expect(party).toContainText('Party');
  await party.click();
  await expect(party).toHaveClass(/active/);
  await expect(page.locator('#games .game')).toHaveCount(1);
});
