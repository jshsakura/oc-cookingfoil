import { test, expect } from '@playwright/test';
import { signIn } from './admin-sign-in';
import { shot } from './shots';

// A registered authenticator reads as done, with the shield, not as an offer to register again.
test('the 2FA card says the authenticator is registered', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin#settings/security');
  const ok = page.locator('#tfa-ok');
  await expect(ok).toBeVisible();
  await expect(ok).toContainText('인증 앱이 등록되어 있습니다');
  await expect(ok.locator('svg')).toBeVisible();
  await expect(page.locator('#tfa-status')).toBeHidden();
  await expect(page.locator('#tfa-actions')).not.toContainText('다시 등록');
  await shot(page.locator('#tfa'), { path: test.info().outputPath('tfa-card.png') });
});
