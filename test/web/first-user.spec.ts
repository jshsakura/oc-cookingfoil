import { test, expect } from '@playwright/test';
import { signIn } from './admin-sign-in';

// The page that makes the first account stays signed in, and the password shows only once.
test('making the first account says what changes, and closing the password window asks', async ({ page }) => {
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
  await expect(ask).toContainText('다음 로그인부터');
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

test('with no password saved here, the button that deletes it is not on the page', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin/settings/admin');
  await expect(page.locator('#ap-status')).toContainText('없습니다');
  await expect(page.locator('#ap-clear')).toBeHidden();
});

test('in English a pending console names its place and a Google account in English', async ({ page }) => {
  await signIn(page);
  await page.evaluate(() => localStorage.setItem('cookingfoil:lang', 'en'));
  await page.route('**/admin/api/devices', async (route) => {
    const res = await route.fetch();
    const d = await res.json();
    await route.fulfill({ json: { ...d, pending: [{ deviceKey: 'a'.repeat(64), firstSeenAt: 1, lastSeenAt: 1, from: { ip: '127.0.0.1', place: 'server', accounts: ['google:'], app: null, version: null } }] } });
  });
  await page.goto('/admin/devices');
  await expect(page.locator('#pending')).toContainText('this server');
  await expect(page.locator('#pending')).toContainText('Google account');
  await page.evaluate(() => localStorage.removeItem('cookingfoil:lang'));
});

test('a refused service key names its field as the card does', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin/settings/integrations');
  const card = page.locator('.intg[data-svc=igdb]');
  await card.locator('input[name=clientId]').fill('bad id !');
  await card.locator('button[type=submit]').click();
  const label = await card.locator('input[name=clientId]').getAttribute('aria-label');
  await expect(card.locator('[data-msg]')).toContainText(label!);
  await expect(card.locator('[data-msg]')).not.toContainText('clientId');
});
