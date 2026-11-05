import { test, expect, type Page } from '@playwright/test';
import { signIn } from './admin-sign-in';

// Passkeys need a secure context and a host name, so these run on localhost, not the suite's 127.0.0.1.
// Chromium's virtual authenticator stands in for the phone: it keeps resident keys and verifies the user.
const LOCAL = `http://localhost:${process.env.COOK_WEB_TEST_PORT}`;
const USER = { name: 'pk-user', password: 'pk-user-password-1' };
const ADMIN = { name: 'pk-admin', password: 'pk-admin-password-1' };
// /login follows the browser's language, which is English here.
const PASSKEY_SIGN_IN = /^(패스키로 로그인|Sign in with a passkey)$/;

async function authenticator(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: {
    protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true,
  } });
}

/** Signed in past the admin page's code, with the session carried over to localhost. */
async function adminOnLocalhost(page: Page) {
  await signIn(page);
  const cookies = await page.context().cookies();
  await page.context().addCookies(cookies.map(({ name, value }) => ({ name, value, url: LOCAL })));
}

test('an admin adds a passkey on 관리자 보안 and it passes the admin check in place of the code', async ({ page }) => {
  await adminOnLocalhost(page);
  await authenticator(page);
  await page.goto(`${LOCAL}/admin/settings/admin`);
  await expect(page.locator('#pk-status')).toHaveText('등록한 패스키가 없습니다.');
  await page.getByRole('button', { name: '패스키 추가' }).click();
  await expect(page.locator('#toast')).toHaveText('패스키를 추가했습니다.');
  await expect(page.locator('#pk-list li')).toHaveCount(1);

  await page.context().clearCookies({ name: 'cf_admin' });
  await page.goto(`${LOCAL}/admin`);
  await page.getByRole('button', { name: '패스키로 로그인' }).click();
  await expect(page.getByRole('heading', { name: 'CookingFoil 서버 관리', exact: true })).toBeVisible();

  await page.goto(`${LOCAL}/admin/settings/admin`);
  await expect(page.locator('#pk-list li').first()).toContainText('마지막 사용:');
  await page.locator('#pk-list li button').click();
  await page.locator('#ask-ok').click();
  await expect(page.locator('#toast')).toHaveText('패스키를 지웠습니다.');
  await expect(page.locator('#pk-list li')).toHaveCount(0);
  await page.context().clearCookies({ name: 'cf_admin' });
  await page.goto(`${LOCAL}/admin`);
  await expect(page.getByRole('button', { name: '패스키로 로그인' })).toHaveCount(0);
});

test('on a plain http address the admin page says passkeys need HTTPS and offers no add', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin/settings/admin');
  await expect(page.locator('#pk-status')).toHaveText('이 주소에서는 패스키를 쓸 수 없습니다. HTTPS 주소로 접속해 주십시오.');
  await expect(page.getByRole('button', { name: '패스키 추가' })).toBeDisabled();
});

async function passwordLogin(page: Page, who: { name: string; password: string }) {
  await page.goto(`${LOCAL}/login`);
  await page.getByLabel(/^(아이디|Username)$/).fill(who.name);
  await page.getByLabel(/^(비밀번호|Password)$/).fill(who.password);
  await page.getByRole('button', { name: /^(로그인|Sign in)$/ }).click();
  await page.evaluate(() => localStorage.setItem('cookingfoil:lang', 'ko'));
}

async function removeAccount(page: Page, name: string) {
  const me = await page.request.get(`${LOCAL}/auth/me`);
  const csrf = me.ok() ? (await me.json()).csrf : '';
  return (await page.request.delete(`${LOCAL}/admin/api/users/${name}?allowEmpty=1`, { headers: { 'X-CSRF-Token': csrf } })).status();
}

test('a signed-in account adds a passkey from the account menu and signs in with it on /login', async ({ page }) => {
  await adminOnLocalhost(page);
  expect((await page.request.post(`${LOCAL}/admin/api/users`, { data: { ...ADMIN, role: 'admin' } })).status()).toBe(201);
  await page.context().clearCookies({ name: 'cf_user' });
  // Once an account exists, the admin API wants an admin account signed in.
  await passwordLogin(page, ADMIN);
  expect((await page.request.post(`${LOCAL}/admin/api/users`, { data: { ...USER, role: 'user' } })).status()).toBe(201);
  await page.context().clearCookies({ name: 'cf_user' });
  try {
    await authenticator(page);
    await page.goto(`${LOCAL}/login`);
    await expect(page.getByRole('button', { name: PASSKEY_SIGN_IN })).toHaveCount(0);
    await passwordLogin(page, USER);
    await page.reload();
    await page.locator('#acct-btn').click();
    await page.locator('#passkey-link').click();
    await expect(page.locator('#pk-msg')).toHaveText('등록한 패스키가 없습니다.');
    await page.locator('#pk-add').click();
    await expect(page.locator('#pk-msg')).toHaveText('패스키를 추가했습니다.');
    await expect(page.locator('#pk-list li')).toHaveCount(1);

    await page.context().clearCookies({ name: 'cf_user' });
    await page.goto(`${LOCAL}/login?next=%2F%23games`);
    await page.getByRole('button', { name: PASSKEY_SIGN_IN }).click();
    await expect(page).toHaveURL(new RegExp(`^${LOCAL}/#`));
    expect((await (await page.request.get(`${LOCAL}/auth/me`)).json()).user).toBe(USER.name);

    // An account made again under a removed one's name does not inherit its passkeys.
    await page.context().clearCookies({ name: 'cf_user' });
    await passwordLogin(page, ADMIN);
    expect(await removeAccount(page, USER.name)).toBe(200);
    expect((await page.request.post(`${LOCAL}/admin/api/users`, { data: { ...USER, role: 'user' } })).status()).toBe(201);
    await page.context().clearCookies({ name: 'cf_user' });
    await page.goto(`${LOCAL}/login`);
    await expect(page.getByRole('button', { name: PASSKEY_SIGN_IN })).toHaveCount(0);
  } finally {
    await page.context().clearCookies({ name: 'cf_user' });
    await passwordLogin(page, ADMIN);
    expect(await removeAccount(page, USER.name)).toBe(200);
    expect(await removeAccount(page, ADMIN.name)).toBe(200);
  }
});
