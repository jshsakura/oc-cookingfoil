import { test, expect } from '@playwright/test';
import { signIn } from './admin-sign-in';
import { shot } from './shots';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

// A Google account's Gravatar takes the account icon's place; a missing one leaves the icon.
for (const where of ['/', '/admin']) {
  test(`the account button shows a picture when there is one (${where})`, async ({ page }) => {
    await signIn(page);
    await page.goto(where);
    const button = page.locator('#acct-btn');
    await expect(button).toBeVisible();
    await page.evaluate(() => (window as any).acctAvatar('https://gravatar.invalid/avatar/x?d=404'));
    await page.waitForTimeout(300);
    await expect(button.locator('svg').first()).toBeVisible();
    await page.evaluate((src) => (window as any).acctAvatar(src), PNG);
    await expect(button.locator('img.acct-avatar')).toBeVisible();
    await shot(button, { path: test.info().outputPath('avatar.png') });
  });
}

// A reload puts the remembered picture on at once instead of the icon first; the account's answer then confirms or clears it.
for (const [where, answer] of [['/', '**/auth/me'], ['/admin', '**/admin/api/counts'], ['/admin/users', '**/admin/api/counts'], ['/admin/settings/server', '**/admin/api/counts']] as const) {
  test(`a reload shows the remembered picture before the account answers (${where})`, async ({ page }) => {
    await signIn(page);
    await page.goto(where);
    await page.evaluate((src) => (window as any).acctAvatar(src), PNG);
    let release: () => void = () => {};
    const held = new Promise<void>((r) => { release = r; });
    await page.route(answer, async (route) => { await held; await route.continue(); });
    await page.reload({ waitUntil: 'domcontentloaded' });
    const button = page.locator('#acct-btn');
    await expect(button.locator('img.acct-avatar')).toBeVisible();
    release();
    // This test account has no picture of its own, so the answer takes the remembered one off.
    await expect(button.locator('svg').first()).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('cf.acct-avatar'))).toBeNull();
  });
}
