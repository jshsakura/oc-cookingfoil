import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import { signIn } from './admin-sign-in';
import { shot } from './shots';

const job = { id: 'public-conversion', kind: 'nsz', title: 'NSZ 로 변환합니다',
  detail: 'Test Game [0100ABCD00000000].nsp', current: 3 * 2 ** 30, total: 6 * 2 ** 30,
  state: 'running', startedAt: Date.now() - 65_000, cancellable: true };

async function prepare(page: Page, admin: boolean) {
  await page.addInitScript(() => localStorage.setItem('cookingfoil:lang', 'ko'));
  await page.route('**/auth/me', route => route.fulfill({ json: { user: admin ? 'Owner' : 'Viewer', admin } }));
  await page.route('**/api/inbox', route => route.fulfill({ json: { enabled: false } }));
  await page.route('**/api/retro/achievements/account', route => route.fulfill({ json: { enabled: false, username: null } }));
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
  await expect(button.locator('svg')).toHaveCount(1);
  const count = button.locator('#act-count');
  await expect(count).toHaveText('1');
  // The number sits in the middle of its dot, not riding on the top edge.
  const [dot, digit] = await count.evaluate(el => {
    const range = document.createRange(); range.selectNodeContents(el);
    const d = el.getBoundingClientRect(), t = range.getBoundingClientRect();
    return [d.top + d.height / 2, t.top + t.height / 2];
  });
  expect(Math.abs(dot - digit)).toBeLessThanOrEqual(1);
  // The number stays on top: the busy ring is never painted over it.
  const onTop = await count.evaluate(el => {
    const r = el.getBoundingClientRect();
    return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === el && getComputedStyle(el).zIndex === '1';
  });
  expect(onTop).toBe(true);
  // Running tasks show only in the account menu; the main page has no board of its own.
  await expect(page.locator('#act-board')).toHaveCount(0);
  await button.click();
  const menu = page.locator('#acct-list');
  await expect(menu.getByRole('group', { name: '테마' }).getByRole('menuitemradio')).toHaveCount(6);
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
  await shot(page, { path: 'out/web/web-account-activity-phone.png' });
  push([]);
  await expect(button).not.toHaveClass(/busy/);
  await expect(button.locator('#act-count')).toBeHidden();
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

test('the account menu is menu items only: the signed-in address is not shown', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cookingfoil:lang', 'ko'));
  await page.route('**/auth/me', route => route.fulfill({ json: { user: 'player@example.com', kind: 'google', admin: false } }));
  await page.route('**/api/inbox', route => route.fulfill({ json: { enabled: false } }));
  await page.route('**/api/activity', route => route.fulfill({ json: { running: [], recent: [] } }));
  await page.route('**/api/retro/achievements/account', route => route.fulfill({ json: { enabled: false, username: null } }));
  await page.routeWebSocket(/\/ws\/library$/, ws => ws.close());
  await page.goto('/');
  await expect(page.locator('meta[name="format-detection"]')).toHaveAttribute('content', /email=no/);
  await page.locator('#acct-btn').click();
  await expect(page.locator('#acct-list')).toBeVisible();
  await expect(page.locator('#acct-list')).not.toContainText('player@example.com');
  await expect(page.locator('#acct-list a[href^="mailto:"]')).toHaveCount(0);
});

test('the account menu rules run edge to edge', async ({ page }) => {
  await signIn(page);
  await page.goto('/');
  await page.locator('#acct-btn').click();
  const list = page.locator('#acct-list');
  await expect(list).toBeVisible();
  const insets = await list.evaluate((el) => {
    const box = el.getBoundingClientRect();
    return ['.menu-sep', '.act-pop', '.act-h.sub'].map((q) => {
      const b = el.querySelector(q)!.getBoundingClientRect();
      return Math.max(b.left - box.left, box.right - b.right);
    });
  });
  for (const inset of insets) expect(inset).toBeLessThanOrEqual(1); // the menu's own border
});
