import { test, expect } from '@playwright/test';
import { signIn } from './admin-sign-in';

// The admin marks a homebrew app as tried on a console; the shop's list then says so.
test('the 검수 pill marks an app verified for the shop and takes it off again', async ({ page, request }) => {
  await signIn(page);
  await page.locator('nav.tabs a[data-tab="homebrew"]').click();
  const pill = () => page.getByRole('button', { name: 'Hand App 검수됨' });
  await expect(pill()).toHaveAttribute('aria-pressed', 'false');
  await expect(pill()).toHaveText('검수 전');
  const listed = async () => {
    const cookie = (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; ');
    const apps = (await (await request.get('/admin/api/homebrew/apps', { headers: { Cookie: cookie } })).json()).apps;
    return apps.find((a: { name: string }) => a.name === 'Hand App')?.verified;
  };
  await pill().click();
  await expect(page.locator('#toast')).toContainText('검수됨 배지를 붙였습니다');
  await expect.poll(listed).toBe(true);
  await expect(pill()).toHaveAttribute('aria-pressed', 'true');
  await expect(pill()).toHaveText('검수됨');

  await pill().click();
  await expect.poll(listed).toBe(false);
  await expect(pill()).toHaveAttribute('aria-pressed', 'false');
});

test('the shop edit panel turns 검수됨 on, and the list shows the badge', async ({ page }) => {
  await signIn(page);
  await page.addInitScript(() => { try { localStorage.setItem('cookingfoil:lang', 'ko'); } catch { /* none */ } });
  await page.goto('/#tools');
  const row = page.locator('#tools-list .xrow', { hasText: 'Hand App' });
  await expect(row.locator('.pill.verified')).toHaveCount(0);
  await row.click();
  await page.locator('#xmodal .modal-gear').click();
  const sw = page.locator('#xmodal .ef-switch', { hasText: '검수됨' }).locator('input');
  await expect(sw).not.toBeChecked();
  await sw.check();
  await page.locator('#xmodal .arted form button[type=submit]').first().click();
  await expect.poll(async () => (await (await page.request.get('/admin/api/homebrew/apps')).json()).apps
    .find((a: { name: string }) => a.name === 'Hand App')?.verified).toBe(true);
  // No reload: back on the detail, its pills and the list behind it show the badge at once.
  await page.locator('#xmodal .modal-gear').click();
  await expect(page.locator('#xm-pills .pill.verified')).toHaveText('검수됨');
  await page.keyboard.press('Escape');
  const badge = page.locator('#tools-list .xrow', { hasText: 'Hand App' }).locator('.pill.verified');
  await expect(badge).toHaveText('검수됨');
  // The badge sits on the name's line, centred with it.
  const [nb, bb] = await Promise.all([page.locator('#tools-list .xrow', { hasText: 'Hand App' }).locator('.xname-text').boundingBox(), badge.boundingBox()]);
  expect(Math.abs((nb!.y + nb!.height / 2) - (bb!.y + bb!.height / 2))).toBeLessThan(1.5);
  // Back off, so other specs see the app as they left it.
  await page.request.post('/admin/api/homebrew/verified', { data: { id: (await (await page.request.get('/admin/api/homebrew/apps')).json()).apps
    .find((a: { name: string }) => a.name === 'Hand App').id, verified: false }, headers: { Origin: new URL(page.url()).origin } });
});
