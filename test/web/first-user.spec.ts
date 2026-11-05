import { test, expect } from '@playwright/test';
import { signIn } from './admin-sign-in';

// The first account signs the page that made it out, and its password shows only once.
test('making the first account warns of the sign-out, and closing the password window asks', async ({ page }) => {
  await signIn(page);
  await page.route('**/admin/api/users', async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { users: [], devices: [] } });
    return route.fulfill({ json: { name: 'owner', password: 'not-a-real-password' } });
  });
  await page.goto('/admin/users');
  await page.locator('#new-name').fill('owner');
  await page.locator('#new-pass').fill('not-a-real-password');
  await page.locator('#add-user button[type=submit]').click();
  const ask = page.locator('#ask-dialog');
  await expect(ask).toContainText('다시 로그인합니다');
  await ask.locator('button.primary, button.danger').first().click();
  await expect(page.locator('#cred-dialog')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(ask).toContainText('비밀번호를 저장했습니까');
  await ask.locator('button:not(.primary):not(.danger)').first().click();
  await expect(page.locator('#cred-dialog')).toBeVisible();

  await page.locator('#cred-close').click();
  await ask.locator('button.primary, button.danger').first().click();
  await expect(page.locator('#cred-dialog')).toBeHidden();
});
