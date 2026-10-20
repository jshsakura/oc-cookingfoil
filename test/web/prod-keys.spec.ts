import { test, expect } from '@playwright/test';
import { signIn } from './admin-sign-in';
import { acceptAsks } from './ask';

// The admin hands the server prod.keys from the settings tab and can take an upload back.
const FAKE = `header_key = ${'a'.repeat(64)}\nkey_area_key_application_00 = ${'b'.repeat(32)}\nmaster_key_00 = ${'c'.repeat(32)}\n`;

test('prod.keys card uploads a file, shows it, and removes it again', async ({ page }) => {
  await signIn(page);
  acceptAsks(page);
  await page.goto('/admin#settings/server');
  await page.locator('#ss-jump').getByRole('tab', { name: 'prod.keys' }).click();
  const status = page.locator('#keys-status');
  await expect(status).toHaveText('없음');

  await page.getByLabel('prod.keys 파일').setInputFiles({ name: 'prod.keys', mimeType: 'text/plain', buffer: Buffer.from('not keys at all') });
  await expect(page.locator('#toast')).toContainText('prod.keys 형식이 아닙니다');
  await expect(status).toHaveText('없음');

  await page.getByLabel('prod.keys 파일').setInputFiles({ name: 'prod.keys', mimeType: 'text/plain', buffer: Buffer.from(FAKE) });
  await expect(status).toContainText('있음 · 업로드');
  await expect(status).toContainText('키 3개');
  await expect(page.locator('.ss-row[data-key="prodKeys"]')).not.toContainText('aaaa');

  await page.locator('.ss-row[data-key="prodKeys"]').getByRole('button', { name: '지우기' }).click();
  await expect(status).toHaveText('없음');
  await expect(page.locator('.ss-row[data-key="prodKeys"]').getByRole('button', { name: '지우기' })).toHaveCount(0);
});
