import { test, expect } from '@playwright/test';
import { apiText } from '../../src/routes/admin/api-words.js';
import { parseLang } from '../../src/meta/langs.js';
import { signIn } from './admin-sign-in';

const LANGUAGES = [
  ['ko', 'ko-KR'], ['en', 'en-US'], ['ja', 'ja-JP'], ['zh', 'zh-CN'],
  ['zh-Hant', 'zh-TW'], ['es', 'es-ES'], ['fr', 'fr-FR'], ['de', 'de-DE'],
  ['it', 'it-IT'], ['pt', 'pt-BR'], ['nl', 'nl-NL'], ['ru', 'ru-RU'],
];
const AT = Date.parse('2020-02-03T04:05:06Z');
test.use({ timezoneId: 'UTC' });

test('all twelve languages format live statistics, persist and reach the API error response', async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page);
  let requestedLanguage = '';
  await page.route('**/admin/api/stats', async (route) => {
    requestedLanguage = route.request().headers()['accept-language'];
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({ response, json: { ...body, generatedAt: AT, totals: { ...body.totals, totalRequests: 1234567 } } });
  });
  await page.goto('/admin');
  for (const [code, locale] of LANGUAGES) {
    await page.locator('#lang-btn').click();
    await page.locator(`#lang-list [data-admin-lang="${code}"]`).click();
    await expect.poll(async () => parseLang(await page.locator('html').getAttribute('lang'))).toBe(code);
    const number = new Intl.NumberFormat(locale).format(1234567);
    const date = new Intl.DateTimeFormat(locale, { timeZone: 'UTC' }).format(AT);
    // Existing values must change when the menu changes, before any reload.
    await expect(page.locator('#cards .card').nth(1).locator('.v')).toHaveText(number);
    await expect(page.locator('#ts')).toContainText(date);
    await page.reload();
    await expect(page.locator('#cards .card').nth(1).locator('.v')).toHaveText(number);
    await expect(page.locator('#ts')).toContainText(date);
    expect(parseLang(requestedLanguage)).toBe(code);
    const expected = apiText(code, 'homebrew.noRepo');
    expect(expected).not.toBe('homebrew.noRepo');
    if (code !== 'en') expect(expected).not.toBe(apiText('en', 'homebrew.noRepo'));
    const response = page.waitForResponse((r) => r.url().endsWith('/admin/api/homebrew/check'));
    const message = await page.evaluate(async () => {
      const client = window as unknown as { api: (url: string, options: unknown) => Promise<unknown> };
      try {
        await client.api('/admin/api/homebrew/check', { method: 'POST', body: { repo: 'missing/not-followed' } });
        return null;
      } catch (error) {
        return (error as Error).message;
      }
    });
    expect((await response).status()).toBe(404);
    expect(message).toBe(expected);
  }
});

for (const [saved, code, locale] of [['pt-BR', 'pt', 'pt-BR'], ['zh-TW', 'zh-Hant', 'zh-TW']]) {
  test(`the saved language ${saved} is normalized consistently with client language codes`, async ({ page }) => {
    await signIn(page);
    await page.evaluate((value) => localStorage.setItem('cookingfoil:lang', value), saved);
    await page.route('**/admin/api/stats', async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      await route.fulfill({ response, json: { ...body, generatedAt: AT, totals: { ...body.totals, totalRequests: 1234567 } } });
    });
    await page.reload();
    await expect.poll(async () => parseLang(await page.locator('html').getAttribute('lang'))).toBe(code);
    await expect(page.locator(`#lang-list [data-admin-lang="${code}"]`)).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('#cards .card').nth(1).locator('.v')).toHaveText(new Intl.NumberFormat(locale).format(1234567));
    await expect(page.locator('#ts')).toContainText(new Intl.DateTimeFormat(locale, { timeZone: 'UTC' }).format(AT));
  });
}
