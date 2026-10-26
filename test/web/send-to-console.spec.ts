import { test, expect } from '@playwright/test';

// "내 기기로 보내기": a signed-in account with an approved console queues the open game for it.
// The server side is covered in test/unit/device-sends-routes.test.js; here the page is driven
// against canned answers so no account has to exist on the test server.
const GAME = 'Test Game [0100000000010000][v0].nsp';

async function signedIn(page, consoles: { deviceKey: string; label: string }[]) {
  await page.addInitScript(() => { try { localStorage.setItem('cookingfoil:lang', 'ko'); } catch { /* none */ } });
  // The page's other signed-in checks (the inbox tray) would otherwise get the test server's 401 and leave for /login.
  await page.route('**/api/inbox**', (route) => route.fulfill({ json: { items: [] } }));
  await page.route('**/auth/me', (route) => route.fulfill({ json: { user: 'alice', kind: 'user', admin: false, csrf: 'x' } }));
  await page.route('**/pair/api/mine', (route) => route.fulfill({ json: { devices: consoles, clients: [] } }));
}

test('the button sends the game to the only console and offers a cancel while it waits', async ({ page }) => {
  await signedIn(page, [{ deviceKey: 'a'.repeat(64), label: '거실 스위치' }]);
  let waiting: object[] = [];
  let posted: { deviceKey: string; path: string } | null = null;
  await page.route('**/pair/api/sends', async (route) => {
    if (route.request().method() === 'POST') {
      posted = route.request().postDataJSON();
      waiting = [{ id: 'abcdef012345', path: posted!.path, name: 'Test Game', sentAt: new Date().toISOString(), sentBy: 'alice' }];
      return route.fulfill({ json: { ok: true, item: waiting[0], existing: false } });
    }
    return route.fulfill({ json: { consoles: waiting.length ? [{ deviceKey: 'a'.repeat(64), items: waiting }] : [] } });
  });
  let cancelled = false;
  await page.route('**/pair/api/sends/abcdef012345/cancel', (route) => { cancelled = true; waiting = []; return route.fulfill({ json: { ok: true } }); });
  await page.goto('/');
  await page.locator('.game').first().click();
  const send = page.locator('#modal-send');
  await expect(send).toBeVisible();
  await expect(send).toHaveText('내 기기로 보내기');
  await send.click();
  await expect(page.locator('.toast')).toContainText('거실 스위치에 보냈습니다');
  expect(posted!.deviceKey).toBe('a'.repeat(64));
  expect(posted!.path).toBe(GAME);
  await expect(page.locator('#modal-send-box .send-row')).toContainText('거실 스위치에서 받기를 기다리고 있습니다');
  await page.locator('#modal-send-box .send-row button').click();
  await expect(page.locator('#modal-send-box .send-row')).toHaveCount(0);
  expect(cancelled).toBe(true);
});

test('with several consoles the button asks which one first', async ({ page }) => {
  await signedIn(page, [{ deviceKey: 'a'.repeat(64), label: '거실' }, { deviceKey: 'b'.repeat(64), label: '침실' }]);
  let posted: { deviceKey: string } | null = null;
  await page.route('**/pair/api/sends', (route) => {
    if (route.request().method() === 'POST') { posted = route.request().postDataJSON(); return route.fulfill({ json: { ok: true, item: {}, existing: false } }); }
    return route.fulfill({ json: { consoles: [] } });
  });
  await page.goto('/');
  await page.locator('.game').first().click();
  await page.locator('#modal-send').click();
  await expect(page.locator('#modal-send-box .send-pick')).toContainText('보낼 기기를 고릅니다');
  await page.locator('#modal-send-box .send-pick button', { hasText: '침실' }).click();
  await expect(page.locator('.toast')).toContainText('침실에 보냈습니다');
  expect(posted!.deviceKey).toBe('b'.repeat(64));
});

test('the button is absent when the account has no approved console', async ({ page }) => {
  await signedIn(page, []);
  await page.goto('/');
  await page.locator('.game').first().click();
  await expect(page.locator('#modal-title')).not.toHaveText('—');
  await expect(page.locator('#modal-send')).toBeHidden();
});
