import { test, expect } from '@playwright/test';
import { signIn } from './admin-sign-in';

// Stage B, first bundle: the trash, inbox, NSZ and records pages are pages of
// their own. Each carries only its own panel markup and script (no hidden
// whole-page sections, no dashboard monolith), asks only its own APIs, and its
// polls stop when the tab hides or the page is left.

const SPLIT: [string, string, string[], RegExp][] = [
  ['/admin/trash', '#tr-list', ['#ib-list', '#nz-list', '#xf-cards', '#cl-list', '#lockouts', '#users'], /^\/admin\/api\/(trash)/],
  ['/admin/inbox', '#ib-list', ['#tr-list', '#nz-list', '#xf-cards', '#cl-list', '#lockouts', '#users'], /^\/admin\/api\/(inbox)/],
  ['/admin/convert', '#nz-list', ['#tr-list', '#ib-list', '#xf-cards', '#cl-list', '#lockouts', '#users'], /^\/admin\/api\/(nsz|server-settings)/],
  ['/admin/logs/downloads', '#xf-cards', ['#tr-list', '#ib-list', '#nz-list', '#cl-list', '#lockouts'], /^\/admin\/api\/(transfers)/],
  ['/admin/logs/clients', '#cl-list', ['#tr-list', '#ib-list', '#nz-list', '#xf-cards', '#lockouts'], /^\/admin\/api\/(client-logs)/],
  ['/admin/logs/security', '#lockouts', ['#tr-list', '#ib-list', '#nz-list', '#xf-cards', '#cl-list'], /^\/admin\/api\/(stats|unlock|denials)/],
];

for (const [path, own, foreign, api] of SPLIT) {
  test(`${path} carries only its own panel and asks only its own APIs`, async ({ page }) => {
    await signIn(page);
    const asked: string[] = [];
    await page.route('**/admin/api/**', (route) => {
      asked.push(new URL(route.request().url()).pathname);
      return route.continue();
    });
    await page.goto(path);
    await expect(page.locator(own)).toBeVisible();
    for (const f of foreign) await expect(page.locator(f), f).toHaveCount(0);
    await page.waitForTimeout(800);
    // The activity menu is part of the shared shell every page carries.
    const strays = asked.filter((u) => !api.test(u) && !/^\/admin\/api\/activity/.test(u));
    expect(strays, `asked ${asked.join(', ')}`).toEqual([]);
  });
}

test('a records page stops polling while its tab is hidden', async ({ page }) => {
  await signIn(page);
  const asked: string[] = [];
  await page.route('**/admin/api/stats', (route) => { asked.push('stats'); return route.continue(); });
  await page.goto('/admin/logs/security');
  await expect(page.locator('#lockouts')).toBeVisible();
  const before = asked.length;
  expect(before).toBeGreaterThan(0);
  await page.evaluate(() => { document.hidden.valueOf(); Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(1200);
  expect(asked.length - before).toBe(0);
});
