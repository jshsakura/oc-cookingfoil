import { test, expect } from '@playwright/test';
import sharp from 'sharp';
import { signIn } from './admin-sign-in';

// A patch's edit window takes its icon: chosen from a file, shown at once, kept in the patch folder, and removed again.
test('a patch icon goes in from its edit window and comes out again', async ({ page }) => {
  const png = await sharp({ create: { width: 96, height: 96, channels: 3, background: '#2a78d6' } }).png().toBuffer();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await signIn(page);
  await page.goto('/admin/patches?tab=list');
  await page.locator('#lib-patches .pt-row', { hasText: '게임 데이터' }).locator('.pt-edit').click();
  const slot = page.locator('#ct-pic');
  await expect(slot).toBeVisible();
  await expect(slot.locator('img')).toBeHidden();
  await slot.locator('input[type=file]').setInputFiles({ name: 'icon.png', mimeType: 'image/png', buffer: png });
  await expect(page.locator('#toast')).toContainText('아이콘을 저장했습니다');
  await expect(slot.locator('img')).toBeVisible();
  expect(await slot.locator('img').evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);

  // The same window opened again shows it, and its remove button takes it out after asking.
  await page.locator('#ct-close').click();
  await page.locator('#lib-patches .pt-row', { hasText: '게임 데이터' }).locator('.pt-edit').click();
  await expect(slot.locator('img')).toBeVisible();
  await slot.locator('[data-pic="remove"]').click();
  await page.locator('#ask-ok').click();
  await expect(slot.locator('img')).toBeHidden();
  await expect(slot.locator('[data-pic="remove"]')).toBeHidden();

  // A file that is not a picture is turned away before it is sent.
  await slot.locator('input[type=file]').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('x') });
  await expect(page.locator('#toast')).toContainText('그림 파일만 올릴 수 있습니다');
  expect(errors).toEqual([]);
});
