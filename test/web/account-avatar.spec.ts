import { test, expect } from '@playwright/test';
import { signIn } from './admin-sign-in';

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
    await button.screenshot({ path: test.info().outputPath('avatar.png') });
  });
}
