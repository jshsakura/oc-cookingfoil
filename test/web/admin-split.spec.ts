import { test, expect } from '@playwright/test';
import { signIn } from './admin-sign-in';

// Stage B, first bundle: the trash, inbox, NSZ and records pages are pages of
// their own. Each carries only its own panel markup and script (no hidden
// whole-page sections, no dashboard monolith), asks only its own APIs, and its
// polls stop when the tab hides or the page is left.

const SPLIT: [string, string, string[], RegExp][] = [
  ['/admin/trash', '#tr-list', ['#ib-list', '#nz-list', '#xf-cards', '#cl-list', '#lockouts', '#users'], /^\/admin\/api\/(trash|counts)/],
  ['/admin/inbox', '#ib-list', ['#tr-list', '#nz-list', '#xf-cards', '#cl-list', '#lockouts', '#users'], /^\/admin\/api\/(inbox|counts)/],
  ['/admin/convert', '#nz-list', ['#tr-list', '#ib-list', '#xf-cards', '#cl-list', '#lockouts', '#users'], /^\/admin\/api\/(nsz|server-settings|counts)/],
  ['/admin/logs/downloads', '#xf-cards', ['#tr-list', '#ib-list', '#nz-list', '#cl-list', '#lockouts'], /^\/admin\/api\/(transfers|counts)/],
  ['/admin/logs/clients', '#cl-list', ['#tr-list', '#ib-list', '#nz-list', '#xf-cards', '#lockouts'], /^\/admin\/api\/(client-logs|counts)/],
  ['/admin/logs/security', '#lockouts', ['#tr-list', '#ib-list', '#nz-list', '#xf-cards', '#cl-list'], /^\/admin\/api\/(stats|unlock|denials|counts)/],
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

test('a records page stops polling while its tab is hidden, wakes when back, and stops for good on pagehide', async ({ page }) => {
  await page.clock.install();
  await signIn(page);
  const asked: string[] = [];
  await page.route('**/admin/api/stats', (route) => { asked.push(`t=${Date.now()}`); return route.continue(); });
  await page.goto('/admin/logs/security');
  await expect(page.locator('#lockouts')).toBeVisible();
  await page.waitForTimeout(100);
  // The first call is immediate; record the baseline.
  expect(asked.length).toBeGreaterThanOrEqual(1);
  const baseline = asked.length;

  // Advance past the 15s cycle: a visible tick must fire.
  await page.clock.fastForward(16000);
  await page.waitForTimeout(200);
  expect(asked.length).toBeGreaterThan(baseline);
  const visibleTicks = asked.length;

  // Hide the tab and advance past several cycles: no request at all.
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.clock.fastForward(50000);
  await page.waitForTimeout(200);
  expect(asked.length).toBe(visibleTicks);

  // Back visible: the poll resumes on the next cycle.
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.clock.fastForward(16000);
  await page.waitForTimeout(200);
  expect(asked.length).toBeGreaterThan(visibleTicks);
  const woken = asked.length;

  // Leaving the page stops the poll for good: no more requests.
  await page.evaluate(() => { dispatchEvent(new Event('pagehide')); });
  await page.clock.fastForward(60000);
  await page.waitForTimeout(200);
  expect(asked.length).toBe(woken);
});

test('the account menu opens on a split page, shows who is in, and signs out', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin/trash');
  await expect(page.locator('#tr-list')).toBeVisible();

  // The account circle opens the menu with the activity list and the theme.
  await page.locator('#acct-btn').click();
  await expect(page.locator('#acct-list')).toBeVisible();
  // The identity arrived (not stuck on "loading").
  await expect(page.locator('#who')).not.toContainText('불러오고 있습니다');
  // The theme switch reflects the state.
  await expect(page.locator('#theme-toggle')).toHaveAttribute('aria-checked', /.*/);

  // Escape closes the menu and returns focus to the button.
  await page.keyboard.press('Escape');
  await expect(page.locator('#acct-list')).toBeHidden();
  await expect(page.locator('#acct-btn')).toBeFocused();

  // The sidebar badges arrived from the counts endpoint.
  const badge = page.locator('aside.adm-side [data-count-id="lock-count"], aside.adm-side #lock-count');
  await expect(badge).toBeAttached();

  // Sign out: the admin session and the web session both end; the page comes
  // back to a gate (the login may auto-redirect when the web session lingers).
  await page.locator('#acct-btn').click();
  await page.locator('#logout').click();
  await expect(page.getByRole('heading', { name: '관리 페이지 확인' })).toBeVisible({ timeout: 10000 });
});
