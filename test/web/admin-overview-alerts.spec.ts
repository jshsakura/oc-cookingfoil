import { test, expect } from '@playwright/test';
import { signIn } from './admin-sign-in';

test('a recent alert on the overview opens its whole message, closes by its button, and leads to the alert history', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await signIn(page);
  await page.route('**/admin/api/overview', async (route) => {
    const res = await route.fetch();
    const d = await res.json();
    d.recent = [{ at: Date.now() - 60000, event: 'test', text: '첫 줄 요약', body: '첫 줄 요약\n둘째 줄 자세한 내용', status: 'failed', detail: 'timeout' }];
    await route.fulfill({ response: res, json: d });
  });
  await page.goto('/admin');
  const row = page.locator('#ov-recent li[role=button]');
  await expect(row).toContainText('첫 줄 요약');
  await row.click();
  const dialog = page.locator('#ov-alert');
  await expect(dialog).toBeVisible();
  await expect(page.locator('#ov-alert-body')).toContainText('둘째 줄 자세한 내용');
  await expect(page.locator('#ov-alert-meta')).toContainText('실패');
  await expect(page.locator('#ov-alert-meta')).toContainText('timeout');
  await page.mouse.click(4, 4);
  await expect(dialog).toBeVisible();
  await page.locator('#ov-alert-x').click();
  await expect(dialog).toBeHidden();

  await row.focus();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('link').click();
  await expect(page).toHaveURL(/\/admin\/logs\/alerts/);
  await expect(page.locator('#al-history')).toBeVisible();
  await expect(page.locator('#alerts-subtabs')).toBeHidden();
  expect(errors).toEqual([]);
});
