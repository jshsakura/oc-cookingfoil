import { test, expect } from '@playwright/test';
import { signIn } from './admin-sign-in';

test('the upload limit saves on screen, survives reload and rejects an oversized upload', async ({ page }) => {
  await signIn(page);
  const settings = '/admin/api/server-settings';
  const original = (await (await page.request.get(settings)).json()).settings.uploadMaxBytes;
  try {
    await page.goto('/admin/settings/server');
    await page.locator('#ss-jump [data-group="dashboard"]').click();
    const input = page.locator('.ss-row[data-key="uploadMaxBytes"] input');
    await expect(input).toBeVisible();
    await input.fill('0.001');
    const saved = page.waitForResponse((r) => r.url().endsWith(settings) && r.request().method() === 'POST');
    await input.press('Tab');
    expect((await saved).ok()).toBe(true);
    const bytes = Math.round(0.001 * 1024 ** 3);
    await page.reload();
    await expect(input).toHaveValue('0.001');
    const current = (await (await page.request.get(settings)).json()).settings.uploadMaxBytes;
    expect(current).toMatchObject({ value: bytes, source: 'saved' });
    const targets = await page.request.get('/admin/api/upload/targets');
    expect(targets.ok()).toBe(true);
    expect((await targets.json()).maxBytes).toBe(bytes);
    const refused = await page.request.post('/admin/api/upload/game', {
      multipart: { files: { name: 'Too large [0100000000010000][v0].nsp', mimeType: 'application/octet-stream', buffer: Buffer.alloc(2 * 1024 ** 2) } },
    });
    expect(refused.status()).toBe(413);
  } finally {
    const restored = await page.request.post(settings, {
      data: { uploadMaxBytes: original.source === 'saved' ? original.value : null },
    });
    expect(restored.ok(), 'restore the original upload setting').toBe(true);
  }
});
