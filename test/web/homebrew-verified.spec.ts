import { test, expect } from '@playwright/test';
import { signIn } from './admin-sign-in';

// The admin marks a homebrew app as tried on a console; the shop's list then says so.
test('the 검수 switch marks an app verified for the shop and takes it off again', async ({ page, request }) => {
  await signIn(page);
  await page.locator('nav.tabs a[data-tab="homebrew"]').click();
  const sw = page.getByLabel('Hand App 검수됨');
  await expect(sw).not.toBeChecked();
  const listed = async () => {
    const cookie = (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; ');
    const apps = (await (await request.get('/admin/api/homebrew/apps', { headers: { Cookie: cookie } })).json()).apps;
    return apps.find((a: { name: string }) => a.name === 'Hand App')?.verified;
  };
  await sw.locator('xpath=..').click();
  await expect(page.locator('.toast').last()).toContainText('검수됨 배지를 붙였습니다');
  await expect.poll(listed).toBe(true);
  await expect(page.getByLabel('Hand App 검수됨')).toBeChecked();

  await page.getByLabel('Hand App 검수됨').locator('xpath=..').click();
  await expect.poll(listed).toBe(false);
});
