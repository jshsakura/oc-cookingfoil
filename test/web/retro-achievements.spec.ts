import { test, expect } from '@playwright/test';

// The RetroAchievements account belongs to the console, which signs in itself; the web page offers no setting for it.
test('the account menu has no retro achievements setting, even with a RetroAchievements key on the server', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cookingfoil:lang', 'ko'));
  await page.route('**/auth/me', route => route.fulfill({ json: { user: 'Viewer', admin: false, csrf: 'c' } }));
  await page.route('**/api/inbox', route => route.fulfill({ json: { enabled: false } }));
  let asked = false;
  await page.route('**/api/retro/achievements/account**', route => { asked = true; return route.fulfill({ json: { enabled: true, username: 'Mario' } }); });
  await page.goto('/');
  await page.locator('#acct-btn').click();
  const menu = page.locator('#acct-list');
  await expect(menu.getByRole('menuitem').first()).toBeVisible();
  await expect(menu.getByText('레트로 업적')).toHaveCount(0);
  await expect(page.locator('#ra-modal')).toHaveCount(0);
  expect(asked).toBe(false);
});
