import { test, expect, type Page } from '@playwright/test';
import { signIn } from './admin-sign-in';
import { THEMES } from '../../src/views/themes.js';

// The web page and the admin pages offer the console client's six themes in the account menu.
// A pick sets html[data-theme], repaints from that theme's tokens and survives a reload.
const SHOTS = process.env.THEME_SHOTS;

async function pickEach(page: Page, path: string, token: string, field: 'ground') {
  for (const theme of THEMES) {
    await page.goto(path);
    await page.locator('#acct-btn').click();
    const item = page.locator(`#acct-list [data-theme-pick="${theme.id}"]`);
    await item.click();
    await expect(item).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('#acct-list [aria-checked="true"][data-theme-pick]')).toHaveCount(1);
    const value = () => page.evaluate((t) => getComputedStyle(document.documentElement).getPropertyValue(t).trim(), token);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme.id);
    expect(await value()).toBe(theme[field]);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme.id);
    expect(await value()).toBe(theme[field]);
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', theme.ground);
  }
}

test('each theme picked on the web page is applied and kept across a reload', async ({ page }) => {
  await pickEach(page, '/', '--ground', 'ground');
});

test('each theme picked on an admin page is applied and kept across a reload', async ({ page }) => {
  await signIn(page);
  await pickEach(page, '/admin', '--bg', 'ground');
});

test('the picker moves with the arrow keys and stays inside a phone screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.locator('#acct-btn').click();
  const items = page.locator('#acct-list [data-theme-pick]');
  await items.first().focus();
  await page.keyboard.press('ArrowRight');
  await expect(items.nth(1)).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(items.last()).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'pink');
  for (const box of await items.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().right))) expect(box).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('screenshots of the themes on the web page and the admin overview', async ({ page }) => {
  test.skip(!SHOTS, 'set THEME_SHOTS to a folder to take them');
  test.setTimeout(180000);
  await signIn(page);
  for (const id of ['navy', 'pink', 'purple', 'green']) {
    for (const [name, path] of [['site', '/'], ['admin', '/admin']]) {
      for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: width > 400 ? 800 : 844 });
        await page.addInitScript((t) => localStorage.setItem('cookingfoil:theme', t), id);
        await page.goto(path);
        await page.locator('#acct-btn').waitFor();
        await page.waitForTimeout(800);
        await page.screenshot({ path: `${SHOTS}/themes-${id}-${name}-${width}.png` });
        if (width === 390 && id === 'pink') {
          await page.locator('#acct-btn').click();
          await page.screenshot({ path: `${SHOTS}/themes-${id}-${name}-menu-${width}.png` });
        }
      }
    }
  }
});
