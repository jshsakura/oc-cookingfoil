import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';

const job = { id: 'public-conversion', kind: 'nsz', title: 'NSZ 로 변환합니다',
  detail: 'Test Game [0100ABCD00000000].nsp', current: 3 * 2 ** 30, total: 6 * 2 ** 30,
  state: 'running', startedAt: Date.now() - 65_000, cancellable: true };

async function prepare(page: Page, admin: boolean) {
  await page.addInitScript(() => localStorage.setItem('cookingfoil:lang', 'ko'));
  await page.route('**/auth/me', route => route.fulfill({ json: { user: admin ? 'Owner' : 'Viewer', admin } }));
  await page.route('**/api/inbox', route => route.fulfill({ json: { enabled: false } }));
  await page.route('**/api/activity', route => route.fulfill({ json: { running: [job], recent: [] } }));
  await page.route('**/admin/api/activity/access', route => route.fulfill({ json: { canCancel: admin } }));
}

test('everyone can see activity in the web account menu, with no stop control for ordinary users', async ({ page }) => {
  await prepare(page, false);
  let push: (running: unknown[]) => void = () => {};
  await page.routeWebSocket(/\/ws\/library$/, ws => {
    push = running => ws.send(JSON.stringify({ type: 'activity', running, recent: [] }));
    push([job]);
  });
  await page.goto('/');
  const button = page.locator('#acct-btn');
  await expect(button).toHaveClass(/busy/);
  await expect(button.locator('.act-user-icon')).toBeHidden();
  await expect(button.locator('.act-busy-icon')).toBeVisible();
  await expect(button.locator('#act-count')).toHaveText('1');
  await button.click();
  const menu = page.locator('#acct-list');
  await expect(menu.getByRole('menuitemcheckbox', { name: '어두운 테마' })).toBeVisible();
  await expect(menu.locator('#act-running .t')).toHaveText('NSZ 로 변환합니다');
  await expect(menu.locator('#act-running .n')).toContainText('50% · 3.0 GB / 6.0 GB');
  await expect(menu.locator('.act-stop')).toHaveCount(0);
  await expect(menu.locator('#act-live')).toHaveText('실시간');
  for (const width of [320, 393, 640, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    const box = (await menu.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(12);
    expect(box.x + box.width).toBeLessThanOrEqual(width - 12);
    expect(await menu.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 393, height: 800 });
  await page.emulateMedia({ colorScheme: 'dark' });
  fs.mkdirSync('out/web', { recursive: true });
  await page.screenshot({ path: 'out/web/web-account-activity-phone.png' });
  push([]);
  await expect(button).not.toHaveClass(/busy/);
  await expect(button.locator('.act-user-icon')).toBeVisible();
  await expect(button.locator('.act-busy-icon')).toBeHidden();
  await expect(page.locator('#act-idle')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(button).toBeFocused();
});

test('a verified admin can stop a task from the web menu after confirmation', async ({ page }) => {
  await prepare(page, true);
  await page.routeWebSocket(/\/ws\/library$/, ws => ws.close());
  const cancelled: string[] = [];
  await page.route('**/admin/api/activity/*/cancel', route => {
    cancelled.push(new URL(route.request().url()).pathname);
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto('/');
  await page.locator('#acct-btn').click();
  const stop = page.locator('#act-running .act-stop');
  await expect(stop).toBeVisible();
  await stop.click();
  await expect(page.locator('#confirm-text')).toHaveText('이 작업을 중지할까요?');
  await expect(page.locator('#confirm-yes')).toHaveText('중지');
  await page.locator('#confirm-no').click();
  expect(cancelled).toEqual([]);
  if (await page.locator('#acct-list').isHidden()) await page.locator('#acct-btn').click();
  await stop.click();
  await page.locator('#confirm-yes').click();
  await expect.poll(() => cancelled).toEqual(['/admin/api/activity/public-conversion/cancel']);
});

test('a failed admin capability check leaves the public status visible without stop controls', async ({ page }) => {
  await prepare(page, true);
  await page.route('**/admin/api/activity/access', route => route.fulfill({ status: 503, json: {} }));
  await page.routeWebSocket(/\/ws\/library$/, ws => ws.close());
  await page.goto('/');
  await page.locator('#acct-btn').click();
  await expect(page.locator('#act-running .t')).toHaveText('NSZ 로 변환합니다');
  await expect(page.locator('#act-running .act-stop')).toHaveCount(0);
});
