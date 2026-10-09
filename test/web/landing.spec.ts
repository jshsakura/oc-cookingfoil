import { test, expect } from '@playwright/test';
import fs from 'node:fs';

test('landing follows the system theme until the visitor picks one, then remembers it', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  const root = page.locator('html');
  await expect(root).not.toHaveAttribute('data-theme', /.+/);
  const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(await background()).toBe('rgb(220, 224, 232)');

  await expect(page.locator('[data-theme-choice="light"]')).toHaveClass(/active/);
  await page.locator('[data-theme-choice="dark"]').click();
  await expect(root).toHaveAttribute('data-theme', 'dark');
  expect(await background()).toBe('rgb(17, 17, 27)');

  await page.reload();
  await expect(root).toHaveAttribute('data-theme', 'dark');
  fs.mkdirSync('out/web', { recursive: true });
  await page.screenshot({ path: 'out/web/landing-dark.png' });
});

test('landing keeps the status badge clear of the title and offers the client config', async ({ page }) => {
  await page.goto('/');
  const badge = await page.locator('#status').boundingBox();
  const title = await page.locator('.header h1').boundingBox();
  expect(title!.y - (badge!.y + badge!.height)).toBeGreaterThanOrEqual(8);
  await expect(page.locator('a[href="/api/client-config"]')).toHaveAttribute('download', 'config.json');
});
