import { test, expect } from '@playwright/test';
import { signIn } from './admin-sign-in';
import { TOP_WORDS } from '../../src/routes/admin/top-i18n.js';

const AT = Date.parse('2020-02-03T04:05:06Z');
const LANGUAGES = ['ko', 'en', 'ja', 'zh', 'zh-Hant', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'ru'];
test.use({ timezoneId: 'UTC', reducedMotion: 'reduce' });

test('translated queue labels repaint cached rows without clearing selections or refetching', async ({ page }) => {
  await signIn(page);
  let calls = 0;
  const item = { id: 'aaaaaaaaaaa1', rel: 'Example.nsp', kind: 'nsp', size: 1024, state: 'waiting', addedAt: AT };
  await page.route(/\/admin\/api\/nsz\?/, async (route) => {
    calls++;
    const response = await route.fetch();
    const real = await response.json();
    await route.fulfill({ json: { ...real, status: 'off', items: [item], total: 51, offset: 0, limit: 50,
      totals: { ...real.totals, waiting: 1, busy: 0 }, active: [] } });
  });
  await page.route('**/admin/api/nsz/log?*', (route) => route.fulfill({ json: {
    items: [{ at: AT, rel: 'Example.nsp', event: 'converted', sizeBefore: 1024, sizeAfter: 512 }],
    total: 51, offset: 0, limit: 50,
  } }));
  await page.goto('/admin/convert');
  await expect(page.locator('#nz-list .nz-row')).toHaveCount(1);
  await expect(page.locator('#nz-log .nz-row')).toHaveCount(1);
  await page.locator('#nz-list .nz-lead input').check();
  const initial = calls;
  for (const lang of LANGUAGES) {
    const words = TOP_WORDS[lang];
    await page.locator('#lang-btn').click();
    await page.locator(`#lang-list [data-admin-lang="${lang}"]`).click();
    await expect(page.locator('#nz-state')).toHaveText(words['ov.off']);
    await expect(page.locator('#nz-filter [data-filter="all"]')).toHaveText(words['t.total']);
    await expect(page.locator('#nz-filter [data-filter="waiting"]')).toHaveText(words['pp.waiting']);
    await expect(page.locator('#nz-list .nz-info .pill')).toHaveText(words['pp.waiting']);
    await expect(page.locator('#nz-list .nz-lead input')).toBeChecked();
    await expect(page.locator('#nz-list .nz-acts button').last()).toHaveAttribute('aria-label', words['fp.remove']);
    await expect(page.locator('#nz-list .nz-acts button').last().locator('svg')).toHaveCount(1);
    await expect(page.locator('#nz-pager button').first()).toHaveText(words['fp.prev']);
    await expect(page.locator('#nz-pager button').last()).toHaveText(words['fp.next']);
    await expect(page.locator('#nz-log-pager button').first()).toHaveText(words['fp.prev']);
    await expect(page.locator('#nz-log .nz-info .pill')).toHaveText(words['s.nsz']);
    const formatted = await page.evaluate((at) => new Date(at).toLocaleString(document.documentElement.lang === 'pt' ? 'pt-BR' : document.documentElement.lang), AT);
    await expect(page.locator('#nz-log .nz-info')).toContainText(formatted);
  }
  expect(calls).toBe(initial);
});
