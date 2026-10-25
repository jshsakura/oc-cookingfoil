import { test, expect, type Page } from '@playwright/test';
import { signIn } from './admin-sign-in';

// Language-change regression on the split people pages. A local account is
// created through the admin API; the one-time password it returns is used to
// sign in on the web (the first account makes the server ask for a session).
// The user is removed when the suite ends so later specs see a fresh server.

const LANGS: [string, Record<string, string>][] = [
  ['en', { users: 'Accounts', devices: 'Devices', header: 'Name', codePh: 'Device code' }],
  ['ja', { users: 'アカウント', devices: 'デバイス', header: '名前', codePh: 'デバイスコード' }],
  ['zh', { users: '账户', devices: '设备', header: '名称', codePh: '设备代码' }],
  ['ko', { users: '계정', devices: '기기', header: '이름', codePh: '기기 화면의 기기 코드 8자리' }],
];

const NAME = 'langtest';
let webPassword = '';

test.beforeEach(async ({ page, request }) => {
  await signIn(page);
  if (!webPassword) {
    const r = await request.post('/admin/api/users', {
      headers: { Cookie: (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; '), Origin: new URL(page.url()).origin },
      data: { name: NAME, password: '', role: 'user' },
    });
    if (r.status() === 201) webPassword = (await r.json()).password ?? '';
  }
  // Sign in on the web so the admin pages open (the first user requires it).
  await page.goto('/login');
  await page.getByLabel(/^(아이디|Username)$/).fill(NAME);
  await page.getByLabel(/^(비밀번호|Password)$/).fill(webPassword);
  await page.getByRole('button', { name: /^(로그인|Sign in)$/ }).click();
  await page.waitForURL(/\/(admin|$)/, { timeout: 10000 }).catch(() => {});
});

test.afterAll(async ({ request }) => {
  if (webPassword) {
    await request.delete(`/admin/api/users/${NAME}?allowEmpty=1`).catch(() => {});
    webPassword = '';
  }
});

for (const [lang, labels] of LANGS) {
  test(`the people pages follow ${lang}`, async ({ page }) => {
    await page.goto('/admin/users');
    await page.locator('#lang-btn').click();
    await page.waitForTimeout(300);
    await page.locator(`#lang-list [data-admin-lang="${lang}"]`).click();
    await page.waitForTimeout(500);

    await expect(page.locator('aside.adm-side')).toContainText(labels.users);

    await page.waitForSelector('#users .ag-row', { timeout: 10000 });
    const header = await page.locator('#users .ag-header-row .ag-header-cell-text').first().textContent();
    expect(header).toBe(labels.header);

    const buttons = page.locator('#users .ag-row button[aria-label]');
    expect(await buttons.count()).toBeGreaterThan(0);
    await expect(buttons.first().locator('svg')).toHaveCount(1);
    const aria = await buttons.first().getAttribute('aria-label');
    expect(aria).toBeTruthy();
    expect(aria).not.toBe('');

    await page.reload();
    await page.waitForSelector('#users .ag-row', { timeout: 10000 });
    expect(await page.locator('#users .ag-header-row .ag-header-cell-text').first().textContent()).toBe(labels.header);

    await page.goto('/admin/devices');
    const ph = await page.locator('#code-in').getAttribute('placeholder');
    expect(ph).toContain(labels.codePh.split(' ')[0]);
  });
}

test('a destructive confirm asks in English, cancel focused, danger colour', async ({ page }) => {
  await page.goto('/admin/users');
  await page.waitForSelector('#users .ag-row', { timeout: 10000 });
  await page.locator('#lang-btn').click();
  await page.waitForTimeout(300);
  await page.locator('#lang-list [data-admin-lang="en"]').click();
  await page.waitForTimeout(500);

  const row = page.locator('#users .ag-row', { hasText: NAME });
  await expect(row).toHaveCount(1);
  const del = row.locator('button').filter({ has: page.locator('svg') }).last();
  await expect(del).toHaveCount(1);
  await del.click();
  const dialog = page.locator('#ask-dialog');
  await expect(dialog).toBeVisible();
  expect(await page.locator('#ask-text').textContent()).toContain(NAME);
  await expect(page.locator('#ask-no')).toBeFocused();
  await expect(page.locator('#ask-ok')).toHaveClass(/danger/);
  await page.locator('#ask-no').click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('#users .ag-row', { hasText: NAME })).toHaveCount(1);
});
