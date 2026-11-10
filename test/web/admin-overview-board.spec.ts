import { test, expect } from '@playwright/test';
import { signIn } from './admin-sign-in';

// The overview's to-do board: a card for every counted job, at zero too, each a link to where it is done.
test('the to-do board shows every counted job as a card that leads to its page', async ({ page }) => {
  await page.route('**/admin/api/overview', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    const todo = (body.todo || []).filter((t: { code: string }) => !['pending-devices', 'damaged', 'inbox', 'pending-accounts', 'plugins-failing', 'lockouts'].includes(t.code));
    await route.fulfill({ response, json: { ...body, todo: [...todo, { code: 'pending-devices', n: 2 }, { code: 'damaged', n: 1 }] } });
  });
  await signIn(page);
  await page.goto('/admin');
  const cards = page.locator('#ov-board a.ov-todo');
  await expect(cards).toHaveCount(6);
  expect(await cards.evaluateAll((as) => as.map((a) => a.getAttribute('href')))).toEqual([
    '/admin/users', '/admin/devices', '/admin/incoming#inbox', '/admin/games?view=verify&check=damaged#library/verify', '/admin/settings/plugins', '/admin/logs/security',
  ]);
  await expect(page.locator('#ov-board a[href="/admin/devices"]')).toContainText('승인을 기다리는 기기 2대');
  await expect(page.locator('#ov-board a[href="/admin/devices"]')).not.toHaveClass(/done/);
  await expect(page.locator('#ov-board a[href^="/admin/games"]')).toHaveClass(/warn/);
  await expect(page.locator('#ov-board a[href="/admin/users"]')).toHaveClass(/done/);
  // Counted jobs live on the board only; the notes under it are the setup warnings.
  await expect(page.locator('#warnings .note', { hasText: '승인을 기다리는 기기' })).toHaveCount(0);
  await page.locator('#ov-board a[href="/admin/devices"]').click();
  await expect(page).toHaveURL(/\/admin\/devices/);
});
