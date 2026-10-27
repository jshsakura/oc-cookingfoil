import { test, expect } from '@playwright/test';

// "찜": the heart in the game window keeps the game on the account's wishlist, and the 찜 chip lists them.
// The server side is covered in test/unit/wishlist-routes.test.js; here the page runs against canned answers.
async function signedIn(page, wished: string[]) {
  await page.addInitScript(() => { try { localStorage.setItem('cookingfoil:lang', 'ko'); } catch { /* none */ } });
  await page.route('**/api/inbox**', (route) => route.fulfill({ json: { items: [] } }));
  await page.route('**/auth/me', (route) => route.fulfill({ json: { user: 'alice', kind: 'user', admin: false, csrf: 'x' } }));
  await page.route('**/pair/api/mine', (route) => route.fulfill({ json: { devices: [], clients: [] } }));
  const calls: { url: string; body: { titleId: string } }[] = [];
  await page.route('**/pair/api/wishlist**', (route) => {
    const req = route.request();
    if (req.method() === 'GET') return route.fulfill({ json: { items: wished.map((titleId) => ({ titleId, name: 'x', addedAt: '2026-10-27T00:00:00.000Z' })) } });
    calls.push({ url: req.url(), body: req.postDataJSON() });
    return route.fulfill({ json: { ok: true } });
  });
  return calls;
}

test('the heart adds the open game to the wishlist and the chip lists it; a second press takes it off', async ({ page }) => {
  const calls = await signedIn(page, []);
  await page.goto('/');
  const chip = page.locator('#chips [data-kind="wish"]');
  await expect(chip).toBeVisible();
  await chip.click();
  await expect(page.locator('#games .empty')).toContainText('찜한 게임이 없습니다');

  await page.locator('#chips [data-kind="base"]').click();
  await page.locator('.game').first().click();
  const heart = page.locator('#modal-wish');
  await expect(heart).toHaveAttribute('aria-pressed', 'false');
  await heart.click();
  await expect(heart).toHaveAttribute('aria-pressed', 'true');
  expect(calls[0].url).toMatch(/\/pair\/api\/wishlist$/);
  expect(calls[0].body.titleId).toBe('0100000000010000');
  await page.locator('#modal .modal-x').click();
  await chip.click();
  await expect(page.locator('#games .game')).toHaveCount(1);

  await page.locator('.game').first().click();
  await heart.click();
  await expect(heart).toHaveAttribute('aria-pressed', 'false');
  expect(calls[1].url).toMatch(/\/pair\/api\/wishlist\/remove$/);
});

test('a game already wished opens with a filled heart', async ({ page }) => {
  await signedIn(page, ['0100000000010000']);
  await page.goto('/');
  await page.locator('.game').first().click();
  await expect(page.locator('#modal-wish')).toHaveAttribute('aria-pressed', 'true');
});

test('signed out there is no heart and no chip', async ({ page }) => {
  await page.route('**/auth/me', (route) => route.fulfill({ status: 401, json: {} }));
  await page.goto('/');
  await expect(page.locator('#chips [data-kind="wish"]')).toBeHidden();
  await page.locator('.game').first().click();
  await expect(page.locator('#modal-wish')).toBeHidden();
});
