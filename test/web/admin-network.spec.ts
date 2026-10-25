import { test, expect } from '@playwright/test';
import { signIn } from './admin-sign-in';

for (const task of [
  { view: 'files', api: 'browse', period: 4000, ready: '#lb-list .ag-row' },
  { view: 'organize', api: 'organize', period: 5000, ready: '#lo-held .empty' },
]) {
  test(`${task.view} polls only its active visible page and resumes after returning`, async ({ page }) => {
    await page.clock.install();
    await signIn(page);
    let calls = 0;
    await page.route(`**/admin/api/library/${task.api}**`, async (route) => {
      calls++;
      if (task.api === 'browse') {
        const response = await route.fetch();
        await route.fulfill({ response, json: { ...await response.json(), pending: true } });
      } else {
        await route.fulfill({ json: { held: [], recent: [], systems: [], running: true, waiting: 1 } });
      }
    });
    await page.goto(`/admin/games?view=${task.view}`);
    await expect(page.locator(task.ready).first()).toBeVisible();
    const initial = calls;
    await page.clock.fastForward(task.period + 500);
    await expect.poll(() => calls).toBeGreaterThan(initial);
    await page.locator('#lib-subtabs [data-lsub="info"]').click();
    const otherTask = calls;
    await page.clock.fastForward(task.period * 3);
    expect(calls).toBe(otherTask);
    await page.locator(`#lib-subtabs [data-lsub="${task.view}"]`).click();
    await expect.poll(() => calls).toBeGreaterThan(otherTask);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const hidden = calls;
    await page.clock.fastForward(task.period * 3);
    expect(calls).toBe(hidden);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { value: false, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.clock.fastForward(task.period + 500);
    await expect.poll(() => calls).toBeGreaterThan(hidden);
    await page.evaluate(() => dispatchEvent(new Event('pagehide')));
    const left = calls;
    await page.clock.fastForward(task.period * 3);
    expect(calls).toBe(left);
  });
}

test('a failed client-log poll reports its error and recovers without an unhandled rejection', async ({ page }) => {
  await page.clock.install();
  await signIn(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let calls = 0;
  await page.route('**/admin/api/client-logs', async (route) => {
    calls++;
    await route.fulfill(calls === 1
      ? { status: 503, json: { error: 'network-temporary' } }
      : { json: { consoles: [], bugReports: [] } });
  });
  await page.goto('/admin/logs/clients');
  await expect(page.locator('#toast')).toHaveText('network-temporary');
  await page.clock.fastForward(31000);
  await expect.poll(() => calls).toBeGreaterThan(1);
  await expect(page.locator('#cl-list .empty')).toBeVisible();
  expect(errors).toEqual([]);
});


test('API calls preserve custom headers and use the selected UI language', async ({ page }) => {
  await signIn(page);
  await page.locator('#lang-btn').click();
  await page.locator('#lang-list [data-admin-lang="fr"]').click();
  let headers: Record<string, string> = {};
  await page.route('**/admin/api/homebrew/check', async (route) => {
    headers = route.request().headers();
    await route.fulfill({ json: { ok: true } });
  });
  await page.evaluate(async () => {
    const client = window as unknown as { api: (url: string, options: unknown) => Promise<unknown> };
    await client.api('/admin/api/homebrew/check', {
      method: 'POST', headers: new Headers({ 'X-Test-Request': 'custom', 'Accept-Language': 'en' }), body: { repo: 'example/project' },
    });
  });
  expect(headers['x-test-request']).toBe('custom');
  expect(headers['accept-language']).toBe('fr');
  expect(headers['content-type']).toBe('application/json');
  expect(headers.accept).toBe('application/json');
});

test('overview security warnings open the administrator security task directly', async ({ page }) => {
  await signIn(page);
  await page.route('**/admin/api/stats', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({ response, json: { ...body, warnings: [{ code: 'admin-unenrolled', severity: 'warn' }] } });
  });
  await page.goto('/admin');
  await page.locator('#warnings .note-go').click();
  await expect(page).toHaveURL(/\/admin\/settings\/admin(?:#settings\/security)?$/);
  await expect(page.locator('aside.adm-side [aria-current="page"]')).toHaveText('관리자 보안');
});
