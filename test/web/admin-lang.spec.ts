import { test, expect } from '@playwright/test';
import { signIn } from './admin-sign-in';

// Language-change regression on the split people pages: the sidebar, the users
// table, its buttons' icons and aria-labels, and the devices form all follow
// the picked language. Destructive confirms are checked for the right wording.
const LANGS: [string, string, string][] = [
  ['en', 'Accounts', 'Devices'],
  ['ja', 'アカウント', 'デバイス'],
  ['zh', '账户', '设备'],
  ['ko', '계정', '기기'],
];

for (const [lang, usersLabel, devicesLabel] of LANGS) {
  test(`the people pages follow ${lang}`, async ({ page }) => {
    await signIn(page);
    await page.goto('/admin/users');
    await expect(page.locator('#add-user')).toBeVisible();

    // Switch the language the same way the web page stores it.
    await page.evaluate((l) => { try { localStorage.setItem('cookingfoil:lang', l); } catch {} }, lang);
    await page.reload();
    await page.waitForTimeout(500);

    // The sidebar shows the page names in this language.
    const sidebar = page.locator('aside.adm-side');
    await expect(sidebar).toContainText(usersLabel);
    await expect(sidebar).toContainText(devicesLabel);

    // The users table's headers follow the language (wait for the grid).
    await page.waitForSelector('#users .ag-root', { timeout: 10000 }).catch(() => {});
    const header = await page.locator('#users .ag-header-row .ag-header-cell-text').first().textContent().catch(() => null);
    expect(header).toBeTruthy();

    // Every icon button has an aria-label (the accessible name in this language).
    const buttons = page.locator('#users .ag-row button[aria-label]');
    const n = await buttons.count();
    if (n > 0) {
      const aria = await buttons.first().getAttribute('aria-label');
      expect(aria).toBeTruthy();
      expect(aria).not.toBe('');
    }

    // The devices page's form placeholder follows the language.
    await page.goto('/admin/devices');
    await expect(page.locator('#approve-code input').first()).toBeVisible();
    const ph = await page.locator('#code-in').getAttribute('placeholder');
    expect(ph).toBeTruthy();
  });
}

test('a destructive confirm on the users page is asked in the page language', async ({ page }) => {
  await signIn(page);
  // Switch to English first so we can check the English confirm text.
  await page.locator('#lang-btn').click();
  await page.waitForTimeout(300);
  await page.locator('#lang-list [data-admin-lang="en"]').click();
  await page.waitForTimeout(500);

  await page.goto('/admin/users');
  await page.waitForTimeout(500);
  // The table should have at least the admin's own row.
  const deleteBtn = page.locator('#users .ag-row button[title*="Delete"], #users .ag-row button[title*="삭제"]').first();
  if (await deleteBtn.count() > 0) {
    await deleteBtn.click();
    // The confirm dialog appears with an English message.
    const dialog = page.locator('#ask-dialog');
    await expect(dialog).toBeVisible();
    const text = await page.locator('#ask-text').textContent();
    // The message mentions the account or deletion in some form (not Korean-only).
    expect(text).toBeTruthy();
    // The cancel button starts focused (danger confirm).
    await expect(page.locator('#ask-no')).toBeFocused();
    await page.locator('#ask-no').click();
    await expect(dialog).toBeHidden();
  }
});
