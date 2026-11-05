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

test('the first account says how many approved consoles it stops', async ({ page }) => {
  await signIn(page);
  await page.route('**/admin/api/users', async (route) => route.fulfill({ json: { users: [], devices: [] } }));
  await page.route('**/admin/api/devices', async (route) => {
    const d = await (await route.fetch()).json();
    await route.fulfill({ json: { ...d, approved: [{ deviceKey: 'a'.repeat(64), addedBy: 'admin', label: 'Kitchen' }, { deviceKey: 'b'.repeat(64), addedBy: 'google:x', label: 'Own' }] } });
  });
  await page.goto('/admin/users');
  await page.locator('#new-name').fill('owner');
  await page.locator('#new-pass').fill('not-a-real-password');
  await page.locator('#add-user button[type=submit]').click();
  await expect(page.locator('#ask-dialog')).toContainText('이미 승인한 기기 1대');
  await page.locator('#ask-no').click();
});

test('a wrong password keeps the name, and a short new password is refused in the page language', async ({ page, request }) => {
  const { removeAccount } = await import('./web-session');
  const NAME = 'keep-name', PASSWORD = 'keep-name-password';
  const adminCookie = await signIn(page);
  await page.goto('/admin/users');
  const short = await page.evaluate(() => (window as any).api('/admin/api/users', { method: 'POST', body: { name: 'short-pw', password: 'short' } }).then(() => null, (e: Error) => e.message));
  expect(short).toContain('비밀번호는 8~128자');
  expect((await page.request.post('/admin/api/users', { data: { name: NAME, password: PASSWORD }, headers: { Origin: new URL(page.url()).origin } })).status()).toBe(201);
  await page.context().clearCookies({ name: 'cf_user' });
  try {
    await page.goto('/login');
    await page.locator('#username').fill(NAME);
    await page.locator('#password').fill('not-the-password');
    await page.locator('#password').press('Enter');
    await expect(page.locator('#username')).toHaveValue(NAME);
    await expect(page.locator('#password')).toBeFocused();
    await page.locator('#password').fill(PASSWORD);
    await page.locator('#password').press('Enter');
    await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  } finally {
    await removeAccount(request, NAME, PASSWORD, adminCookie);
  }
});
