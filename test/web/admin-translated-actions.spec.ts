import { test, expect } from '@playwright/test';
import { signIn } from './admin-sign-in';
import { TOP_WORDS } from '../../src/routes/admin/top-i18n.js';

const LANGUAGES = ['ko', 'en', 'ja', 'zh', 'zh-Hant', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'ru'];

test('homebrew upload and removal actions render icons and work in all twelve languages', async ({ page }) => {
  await signIn(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/admin/api/homebrew/apps', (route) => route.fulfill({ json: {
    held: [], apps: [
      { id: 'm-example', app: 'example', name: 'Example app', source: 'manual', enabled: true, kind: 'tool', cores: 3, size: 1024,
        patches: [{ id: 'example-patch', name: 'Example patch', size: 16, verified: false }], saves: [] },
      { id: 'g-example', app: 'other', name: 'Tracked app', source: 'github', repo_url: 'https://github.com/example/project', enabled: true, kind: 'tool', cores: 3, size: 1024, patches: [], saves: [] },
    ],
  } }));
  for (const lang of LANGUAGES) {
    await page.evaluate((value) => localStorage.setItem('cookingfoil:lang', value), lang);
    await page.goto('/admin/homebrew?tab=apps');
    const cards = page.locator('#hb-apps .hb-app');
    await expect(cards).toHaveCount(2);
    for (const card of await cards.all()) {
      const upload = card.locator('.hb-up');
      await expect(upload).toHaveCount(2);
      await expect(upload.nth(0).locator('svg')).toHaveCount(1);
      await expect(upload.nth(1).locator('svg')).toHaveCount(1);
      await expect(upload.nth(0).locator('span')).toHaveText(TOP_WORDS[lang]['u.kPatch']);
      await expect(upload.nth(1).locator('span')).toHaveText(TOP_WORDS[lang]['u.kSave']);
      await expect(upload.nth(0)).toHaveAttribute('aria-label', TOP_WORDS[lang]['rpt.apply']);
      await expect(upload.nth(1)).toHaveAttribute('aria-label', TOP_WORDS[lang]['up.entry'] + ' · ' + TOP_WORDS[lang]['u.kSave']);
      await expect(card.locator('.hb-foot button.danger svg')).toHaveCount(1);
    }
    await expect(cards.first().locator('.hb-extras button.danger svg')).toHaveCount(1);
  }
  const upload = page.locator('#hb-apps .hb-app').first().locator('.hb-up');
  await upload.nth(0).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe('/admin/upload');
  expect(new URL(page.url()).searchParams.get('kind')).toBe('patch');
  expect(new URL(page.url()).searchParams.get('app')).toBe('example');
  await page.goto('/admin/homebrew?tab=apps');
  await page.locator('#hb-apps .hb-app').first().locator('.hb-up').nth(1).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe('/admin/upload');
  expect(new URL(page.url()).searchParams.get('kind')).toBe('save');
  expect(new URL(page.url()).searchParams.get('app')).toBe('example');
  expect(errors).toEqual([]);
});
