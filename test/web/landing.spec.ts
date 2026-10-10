import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import type { Page } from '@playwright/test';

async function pickLang(page: Page, code: string) {
  await page.locator('#lang-btn').click();
  await page.locator(`#lang-list [data-lang="${code}"]`).click();
  await expect(page.locator('#lang-list')).toBeHidden();
}

test('landing follows the system theme until the visitor picks one, then remembers it', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  const root = page.locator('html');
  await expect(root).not.toHaveAttribute('data-theme', /.+/);
  const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(await background()).toBe('rgb(242, 241, 238)');

  await expect(page.locator('#theme-btn')).toHaveAttribute('data-current', 'light');
  await page.locator('#theme-btn').click();
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
  await pickLang(page, 'ko');
  const party = page.locator('#genre-chips [data-genre="Party"]');
  await expect(party).toContainText('파티');
  await pickLang(page, 'en');
  await expect(party).toContainText('Party');
  await pickLang(page, 'ja');
  await expect(party).toContainText('パーティー');
  await expect(page.locator('.tabs [data-tab="games"]')).toHaveText('すべてのゲーム');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
  await pickLang(page, 'zh');
  await expect(party).toContainText('派對');
  await pickLang(page, 'en');
  await party.click();
  await expect(party).toHaveClass(/active/);
  await expect(page.locator('#games .game')).toHaveCount(1);
});

test('score badges read the section scores and label them in the page language', async ({ page }) => {
  await page.route('**/api/shop/sections', (route) => route.fulfill({
    json: {
      sections: [{ id: 'all', title: 'All', items: [{
        app_type: 'base', title_id: '0100000000010000', categories: ['Party'],
        score: 75, score_count: 25575, score_source: 'steam', score_label: 'Mostly Positive',
      }] }],
      genres: { Party: { en: 'Party', ko: '파티', ja: 'パーティー', zh: '派對' } },
      score_labels: { 'Mostly Positive': { en: 'Mostly Positive', ko: '대체로 긍정적', ja: 'やや好評', zh: '大多好評' } },
    },
  }));
  await page.goto('/');
  await pickLang(page, 'ko');
  const pill = page.locator('#games .score-badge');
  await expect(pill).toHaveText('75');
  // Steam's "Mostly Positive" tier, not the score range
  await expect(pill).toHaveClass(/fair/);
  const chip = page.locator('#steam-chips [data-steam="Mostly Positive"]');
  await expect(chip).toContainText('대체로 긍정적');
  await chip.click();
  await expect(page.locator('#games .game')).toHaveCount(1);
  await expect(pill).toHaveAttribute('title', '75 · 대체로 긍정적 · 25,575명');
  await pickLang(page, 'en');
  await expect(page.locator('#games .score-badge')).toHaveAttribute('title', '75 · Mostly Positive · 25,575 reviews');
});

test('tabs switch between all games and the client preview and remember the choice', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.tabs [data-tab="games"]')).toHaveClass(/active/);
  await expect(page.locator('#shop-url')).toBeVisible();
  await expect(page.locator('#games .game')).toHaveCount(1);
  await page.locator('.tabs [data-tab="preview"]').click();
  await expect(page.locator('#search')).toBeHidden();
  await expect(page.locator('#shop-url')).toBeVisible();
  await expect(page).toHaveURL(/#preview$/);
  await page.goto('/');
  await expect(page.locator('.tabs [data-tab="preview"]')).toHaveClass(/active/);
  await page.locator('.tabs [data-tab="games"]').click();
  await expect(page).toHaveURL(/#all$/);
  await page.setViewportSize({ width: 1280, height: 300 });
  await page.reload();
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test('the language menu opens on demand, shows the current code and closes on Escape', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#lang-list')).toBeHidden();
  await pickLang(page, 'ja');
  await expect(page.locator('#lang-current')).toHaveText('JA');
  await page.locator('#lang-btn').click();
  await expect(page.locator('#lang-list [data-lang="ja"]')).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await expect(page.locator('#lang-list')).toBeHidden();
  await expect(page.locator('a.admin-link svg')).toBeVisible();
});
