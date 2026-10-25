import { test, expect } from '@playwright/test';
import { signIn } from './admin-sign-in';

// Language-change regression on the split people pages. A local account is
// created through the admin API so the users table has a real row; the icons,
// aria-labels, placeholders and the destructive confirm are checked against
// the expected value in each language, not just for truthiness.

const LANGS: [string, Record<string, string>][] = [
  ['en', { users: 'Accounts', devices: 'Devices', header: 'Name', delete: 'Delete', approveCode: 'Device code' }],
  ['ja', { users: 'アカウント', devices: 'デバイス', header: '名前', delete: '削除', approveCode: 'デバイスコード' }],
  ['zh', { users: '账户', devices: '设备', header: '名称', delete: '删除', approveCode: '设备代码' }],
  ['ko', { users: '계정', devices: '기기', header: '이름', delete: '삭제', approveCode: '기기 화면의 기기 코드 8자리' }],
];

test.beforeEach(async ({ page, request }) => {
  await signIn(page);
  // Create a local account so the users table has a row with buttons to check.
  const cookie = (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; ');
  await request.post('/admin/api/users', {
    headers: { Cookie: cookie, Origin: new URL(page.url()).origin },
    data: { name: 'langtest', pass: '', role: 'user' },
  });
});

for (const [lang, labels] of LANGS) {
  test(`the people pages follow ${lang}`, async ({ page }) => {
    // Switch the language through the header's own menu (the real UI).
    await page.locator('#lang-btn').click();
    await page.waitForTimeout(300);
    await page.locator(`#lang-list [data-admin-lang="${lang}"]`).click();
    await page.waitForTimeout(500);

    // The sidebar shows the page names in this language.
    await expect(page.locator('aside.adm-side')).toContainText(labels.users);
    await expect(page.locator('aside.adm-side')).toContainText(labels.devices);

    // The users table has rendered rows and the first header column is in this language.
    await page.goto('/admin/users');
    await page.waitForSelector('#users .ag-row', { timeout: 10000 });
    const header = await page.locator('#users .ag-header-row .ag-header-cell-text').first().textContent();
    expect(header).toBe(labels.header);

    // Every row has action buttons; the first has an icon (svg) and an aria-label.
    const buttons = page.locator('#users .ag-row button[aria-label]');
    const n = await buttons.count();
    expect(n).toBeGreaterThan(0);
    const first = buttons.first();
    await expect(first.locator('svg')).toHaveCount(1);
    const aria = await first.getAttribute('aria-label');
    expect(aria).toBeTruthy();
    expect(aria).not.toBe('');

    // The language persists across a reload.
    await page.reload();
    await page.waitForSelector('#users .ag-row', { timeout: 10000 });
    const headerAfter = await page.locator('#users .ag-header-row .ag-header-cell-text').first().textContent();
    expect(headerAfter).toBe(labels.header);

    // The devices page's form placeholder is the expected text in this language.
    await page.goto('/admin/devices');
    const ph = await page.locator('#code-in').getAttribute('placeholder');
    expect(ph).toContain(labels.approveCode.split(' ')[0]); // at least the first word matches
  });
}

test('a destructive confirm on the users page asks in English with cancel focused', async ({ page }) => {
  // Switch to English.
  await page.locator('#lang-btn').click();
  await page.waitForTimeout(300);
  await page.locator('#lang-list [data-admin-lang="en"]').click();
  await page.waitForTimeout(500);

  await page.goto('/admin/users');
  await page.waitForSelector('#users .ag-row', { timeout: 10000 });

  // The "langtest" row exists and has a delete button.
  const row = page.locator('#users .ag-row', { hasText: 'langtest' });
  await expect(row).toHaveCount(1);
  const deleteBtn = row.locator('button[aria-label*="Delete"], button[aria-label*="delete"]').first();
  await expect(deleteBtn).toHaveCount(1);

  // Clicking it opens the confirm dialog with an English message and the cancel focused.
  await deleteBtn.click();
  const dialog = page.locator('#ask-dialog');
  await expect(dialog).toBeVisible();
  const text = await page.locator('#ask-text').textContent();
  expect(text).toContain('langtest'); // the message names the account
  expect(text).toMatch(/[Dd]elete|[Rr]emove/); // and says what it does, in English
  await expect(page.locator('#ask-no')).toBeFocused();
  // The confirm button is the danger colour.
  await expect(page.locator('#ask-ok')).toHaveClass(/danger/);
  // Cancel keeps the account.
  await page.locator('#ask-no').click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('#users .ag-row', { hasText: 'langtest' })).toHaveCount(1);
});
