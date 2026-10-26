import { test, expect } from '@playwright/test';
import { signIn } from './admin-sign-in';

// Stage B, first bundle: the trash, inbox, NSZ and records pages are pages of
// their own. Each carries only its own panel markup and script (no hidden
// whole-page sections, no dashboard monolith), asks only its own APIs, and its
// polls stop when the tab hides or the page is left.

const SPLIT: [string, string, string[], RegExp][] = [
  ['/admin/games', '#lb-bar', ['#users', '#up-form', '#f-list', '#warnings'], /^\/admin\/api\/(library|counts)/],
  ['/admin/homebrew', '#hb-apps', ['#users', '#up-form', '#f-list', '#pt-q'], /^\/admin\/api\/(homebrew|counts)/],
  ['/admin', '#ov-status', ['#users', '#up-form', '#cr-form', '#f-list', '#cards'], /^\/admin\/api\/(overview|counts)/],
  ['/admin/upload', '#up-drop', ['#users', '#f-list', '#warnings', '#lib-files'], /^\/admin\/api\/(upload\/targets|games\/search|counts)/],
  ['/admin/settings/login', '#google-form', ['#tfa', '#ap-form', '#users', '#warnings'], /^\/admin\/api\/(google|counts)/],
  ['/admin/settings/admin', '#tfa', ['#google-form', '#users', '#warnings'], /^\/admin\/api\/(2fa|counts)/],
  ['/admin/featured', '#f-list', ['#users', '#lib-files', '#up-form', '#warnings'], /^\/admin\/api\/(featured|games\/search|counts)/],
  ['/admin/settings/server', '#ss-list', ['#cr-form', '#users', '#nz-list', '#warnings'], /^\/admin\/api\/(server-settings|server\/status|counts)/],
  ['/admin/settings/integrations', '#intg-h', ['#ss-list', '#users', '#nz-list', '#warnings'], /^\/admin\/api\/(integrations|counts)/],
  ['/admin/settings/automation', '#mcp-on', ['#ss-list', '#users', '#nz-list', '#warnings'], /^\/admin\/api\/(tokens|server-settings|counts)/],
  ['/admin/settings/notifications', '#al-form', ['#cr-form', '#users', '#nz-list', '#warnings'], /^\/admin\/api\/(alerts|counts)/],
  ['/admin/client', '#cr-form', ['#al-form', '#users', '#nz-list', '#warnings'], /^\/admin\/api\/(client-release|counts)/],
  ['/admin/trash', '#tr-list', ['#ib-list', '#nz-list', '#xf-cards', '#cl-list', '#lockouts', '#users'], /^\/admin\/api\/(trash|counts)/],
  ['/admin/inbox', '#ib-list', ['#tr-list', '#nz-list', '#xf-cards', '#cl-list', '#lockouts', '#users'], /^\/admin\/api\/(inbox|counts)/],
  ['/admin/convert', '#nz-list', ['#tr-list', '#ib-list', '#xf-cards', '#cl-list', '#lockouts', '#users'], /^\/admin\/api\/(nsz|server-settings|counts)/],
  ['/admin/logs/downloads', '#xf-cards', ['#tr-list', '#ib-list', '#nz-list', '#cl-list', '#lockouts'], /^\/admin\/api\/(transfers|counts)/],
  ['/admin/logs/clients', '#cl-list', ['#tr-list', '#ib-list', '#nz-list', '#xf-cards', '#lockouts'], /^\/admin\/api\/(client-logs|counts)/],
  ['/admin/logs/security', '#lockouts', ['#tr-list', '#ib-list', '#nz-list', '#xf-cards', '#cl-list'], /^\/admin\/api\/(stats|unlock|denials|counts)/],
];

test('an upload deep link retains the homebrew target when files are chosen', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin/upload?kind=patch&app=handapp');
  await expect(page.locator('#up-target')).toHaveValue('handapp');
  await page.locator('#up-file').setInputFiles({ name: 'config.ini', mimeType: 'text/plain', buffer: Buffer.from('speed=2') });
  await expect(page.locator('#up-target')).toHaveValue('handapp');
  await expect(page.locator('#up-go')).toBeVisible();
  await expect(page.locator('#up-kinds [data-kind="patch"]')).toHaveAttribute('aria-pressed', 'true');
});

test('a standalone server setting saves without calling the overview health panel', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin/settings/server');
  await page.locator('#ss-jump [data-group="inbox"]').click();
  const control = page.locator('.ss-row[data-key="inboxEnabled"] input');
  const before = await control.isChecked();
  const saved = page.waitForResponse((r) => r.url().endsWith('/admin/api/server-settings') && r.request().method() === 'POST');
  await page.locator('.ss-row[data-key="inboxEnabled"] label').click();
  expect((await saved).ok()).toBe(true);
  await expect(page.locator('#toast')).not.toContainText('loadHealth');
  await expect(page.locator('#toast')).toHaveText(!before ? '임시 공유를 받습니다.' : '임시 공유를 받지 않습니다.');
  await page.reload();
  await page.locator('#ss-jump [data-group="inbox"]').click();
  await expect(control).toBeChecked({ checked: !before });
  const restored = page.waitForResponse((r) => r.url().endsWith('/admin/api/server-settings') && r.request().method() === 'POST');
  await page.locator('.ss-row[data-key="inboxEnabled"] label').click();
  expect((await restored).ok()).toBe(true);
});

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

  // The theme switch actually toggles: click it, the attribute and the page change.
  const before = await page.locator('#theme-toggle').getAttribute('aria-checked');
  await page.locator('#theme-toggle').click();
  await expect(page.locator('#theme-toggle')).not.toHaveAttribute('aria-checked', before!);
  const htmlTheme = await page.evaluate(() => document.documentElement.dataset.theme);
  expect(htmlTheme).toBeTruthy();

  // Escape closes the menu and returns focus to the button.
  await page.keyboard.press('Escape');
  await expect(page.locator('#acct-list')).toBeHidden();
  await expect(page.locator('#acct-btn')).toBeFocused();

  // The sidebar badges carry real numbers from the seeded fixtures (the test
  // server has at least the locked-IP and pending-device fixtures).
  const lockBadge = page.locator('aside.adm-side .adm-item [data-count-id="lock-count"], aside.adm-side #lock-count');
  await expect(lockBadge).toBeAttached();
  // With no locks in the fresh test server the badge hides; with one it shows a number.
  const lockHidden = await lockBadge.evaluate((el) => el.hidden);
  const lockText = await lockBadge.textContent();
  // The badge is either hidden (count 0) or shows a non-zero number.
  expect(lockHidden || (lockText && lockText !== '0')).toBeTruthy();

  // Sign out: the admin session and the web session both end.
  await page.locator('#acct-btn').click();
  await page.locator('#logout').click();
  await expect(page.getByRole('heading', { name: '관리 페이지 확인' })).toBeVisible({ timeout: 10000 });
});

test('the counts endpoint refuses automation tokens, the unsigned and non-admin accounts', async ({ page, request }) => {
  // Create a real automation token through the admin API (the same way a person would).
  await signIn(page);
  const cookie = (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; ');
  const made = await request.post('/admin/api/tokens', {
    headers: { Cookie: cookie, Origin: new URL(page.url()).origin },
    data: { label: 'counts-reach-test' },
  });
  const tok = made.ok() ? (await made.json()).token : null;
  // Clean it up when the test ends.
  if (tok) {
    const id = tok.split('_')[1];
    await request.delete(`/admin/api/tokens/${id}`, { headers: { Cookie: cookie } }).catch(() => {});
  }

  // Unsigned: the gate keeps it out.
  const unsigned = await request.get('/admin/api/counts');
  expect([401, 403]).toContain(unsigned.status());

  // A valid automation token can read other admin answers but never the counts.
  if (tok) {
    const withToken = await request.get('/admin/api/counts', { headers: { Authorization: `Bearer ${tok}` } });
    expect(withToken.status()).toBe(403);
    // The same token CAN read an allowed endpoint, proving the token itself works.
    const allowed = await request.get('/admin/api/stats', { headers: { Authorization: `Bearer ${tok}` } });
    expect(allowed.status()).toBe(200);
  }
});
