import { test, expect } from '@playwright/test';
import { signIn } from './admin-sign-in';

// Language-change regression on the split people pages. A local account is
// created through the admin API; the one-time password it returns is used to
// sign in on the web (the first account makes the server ask for a session).
// The user is removed when the suite ends so later specs see a fresh server.

const LANGS: [string, Record<string, string>][] = [
  ['en', { users: 'Accounts', devices: 'Devices', header: 'Name', codePh: 'Device code on the console screen', action: 'Change password' }],
  ['ja', { users: 'アカウント', devices: 'デバイス', header: '名前', codePh: '本体画面のデバイスコード 8 桁', action: 'パスワード変更' }],
  ['zh', { users: '账户', devices: '设备', header: '名称', codePh: '主机屏幕上的设备代码 8 位', action: '更改密码' }],
  ['ko', { users: '계정', devices: '기기', header: '이름', codePh: '기기 화면의 기기 코드 8자리', action: '비밀번호 변경' }],
];

const NAME = 'langtest';
let webPassword = '';
test.setTimeout(120_000);

test.beforeEach(async ({ page, request }) => {
  await signIn(page);
  if (!webPassword) {
    const r = await request.post('/admin/api/users', {
      headers: { Cookie: (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; '), Origin: new URL(page.url()).origin },
      data: { name: NAME, password: '', role: 'user' },
    });
    expect(r.status()).toBe(201);
    const d = await r.json();
    webPassword = d.password ?? '';
    expect(webPassword).toBeTruthy();
  }
  // Sign in on the web: the first user makes the whole server ask for it.
  await page.goto('/login');
  await page.getByLabel(/^(아이디|Username)$/).fill(NAME);
  await page.getByLabel(/^(비밀번호|Password)$/).fill(webPassword);
  await page.getByRole('button', { name: /^(로그인|Sign in)$/ }).click();
  // The login must actually succeed (not just timeout silently).
  await expect(page).not.toHaveURL(/\/login/, { timeout: 10000 });
});

test.afterEach(async ({ page }) => {
  if (!webPassword) return;
  const csrf = (await page.context().cookies()).find((c) => c.name === 'cf_csrf')?.value ?? '';
  const r = await page.request.delete(`/admin/api/users/${NAME}?allowEmpty=1`, {
    headers: { 'X-CSRF-Token': csrf },
  });
  expect(r.ok(), 'remove the fixture account with both authenticated sessions').toBe(true);
  webPassword = '';
});

test('the people pages follow en, ja, zh and ko', async ({ page }) => {
  test.setTimeout(120_000); // one signIn for all four languages
  await page.goto('/admin/users');
  for (const [lang, labels] of LANGS) {
    await page.locator('#lang-btn').click();
    await page.waitForTimeout(300);
    await page.locator(`#lang-list [data-admin-lang="${lang}"]`).click();
    await page.waitForTimeout(500);

    await expect(page.locator('aside.adm-side')).toContainText(labels.users);

    await page.waitForSelector('#users .ag-row', { timeout: 10000 });
    expect(await page.locator('#users .ag-header-row .ag-header-cell-text').first().textContent()).toBe(labels.header);

    const actions = page.locator('#users .ag-row .row-actions button.ib');
    expect(await actions.count()).toBeGreaterThan(0);
    await expect(actions.first().locator('svg')).toHaveCount(1);
    await expect(actions.first()).toHaveAccessibleName(labels.action);

    await page.reload();
    await page.waitForSelector('#users .ag-row', { timeout: 10000 });
    expect(await page.locator('#users .ag-header-row .ag-header-cell-text').first().textContent()).toBe(labels.header);

    await page.goto('/admin/devices');
    const ph = await page.locator('#code-in').getAttribute('placeholder');
    expect(ph).toBe(labels.codePh);
    await page.goto('/admin/users');
  }

  // Destructive confirm: switch to English, find the Delete button by its
  // accessible name, check the dialog's message, focus and the warning card (the client's way: no red button).
  await page.goto('/admin/users');
  await page.waitForSelector('#users .ag-row', { timeout: 15000 });
  await page.locator('#lang-btn').click();
  await page.waitForTimeout(300);
  await page.locator('#lang-list [data-admin-lang="en"]').click();
  await page.waitForTimeout(500);
  const row = page.locator('#users .ag-row', { hasText: NAME });
  await expect(row).toHaveCount(1);
  const del = row.locator('.row-actions button.ib[aria-label="Delete"]');
  await expect(del).toHaveCount(1);
  await del.click();
  const dialog = page.locator('#ask-dialog');
  await expect(dialog).toBeVisible();
  await expect(page.locator('#ask-text')).toHaveText('langtest is the last account. Removing it opens the server to anyone without a password.');
  await expect(page.locator('#ask-no')).toBeFocused();
  await expect(dialog).toHaveClass(/\bwarn\b/);
  await expect(page.locator('#ask-ok')).toHaveClass('primary');
  await page.locator('#ask-no').click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('#users .ag-row', { hasText: NAME })).toHaveCount(1);
});


