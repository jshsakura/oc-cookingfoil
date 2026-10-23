import { test, expect, type Page } from '@playwright/test';
import sharp from 'sharp';
import { signIn } from './admin-sign-in';

// Pictures are edited by admin accounts from the dashboard whether or not the server takes
// web uploads (a library setting); accounts with the user role never see the editor.
const ADMIN = { name: 'art-admin', password: 'art-admin-password-1' };
const VIEWER = { name: 'art-viewer', password: 'art-viewer-password-1' };

// The page stays signed in as ADMIN (and past the admin page's code), so it takes the accounts out again.
test.afterEach(async ({ page }) => {
  const me = await page.request.get('/auth/me');
  if (!me.ok()) return;
  const headers = { 'X-CSRF-Token': (await me.json()).csrf };
  for (const name of [VIEWER.name, ADMIN.name]) await page.request.delete(`/admin/api/users/${name}?allowEmpty=1`, { headers });
  expect((await (await page.request.get('/admin/api/users')).json()).users).toEqual([]);
});

const png = () => sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 30, g: 160, b: 220 } } }).png().toBuffer();

async function login(page: Page, who: { name: string; password: string }) {
  await page.goto('/login');
  await page.getByLabel(/^(아이디|Username)$/).fill(who.name);
  await page.getByLabel(/^(비밀번호|Password)$/).fill(who.password);
  await page.getByRole('button', { name: /^(로그인|Sign in)$/ }).click();
  await page.evaluate(() => localStorage.setItem('cookingfoil:lang', 'ko'));
}

// Past the admin page's code while the server has no accounts, then signed in as a new admin account.
async function adminAccount(page: Page) {
  await signIn(page);
  expect((await page.request.post('/admin/api/users', { data: { ...ADMIN, role: 'admin' } })).status()).toBe(201);
  await login(page, ADMIN);
}

async function choose(page: Page, tile: ReturnType<Page['locator']>, cropped: boolean) {
  const chooser = page.waitForEvent('filechooser');
  await tile.locator('.face').click();
  await (await chooser).setFiles({ name: 'tiny.png', mimeType: 'image/png', buffer: await png() });
  if (cropped) await page.locator('.crop .crop-actions .btn:not(.ghost)').click();
}

test('an admin account edits a Switch game\'s and a retro game\'s pictures with web uploads off', async ({ page }) => {
  await adminAccount(page);
  expect((await page.request.post('/admin/api/server-settings', { data: { uploadsEnabled: false } })).status()).toBe(200);
  try {
    // What the page used to ask: the upload tray as it answers with uploads off.
    await page.route('**/api/uploads', (route) => route.fulfill({ status: 503, json: { error: 'uploads disabled' } }));

    await page.goto('/#all');
    await page.locator('#games .game').first().click();
    await page.locator('#modal .modal-gear').click();
    const card = page.locator('#modal-art .arted');
    await expect(card).toBeVisible();
    await choose(page, card.locator('.atile.a-icon'), true);
    await expect(card.locator('.atile.a-icon .reset')).toBeVisible();
    await expect(card.locator('.atile.a-icon img')).toBeVisible();
    // Back as it was, for the specs after this one.
    await card.locator('.atile.a-icon .reset').click();
    await expect(page.locator('#modal-art .atile.a-icon .reset')).toHaveCount(0);
    await page.locator('#modal .modal-x').click();

    await page.goto('/#retro');
    const gunbird = page.locator('#retro-games .game').filter({ hasNotText: '슈퍼 시노비' });
    await expect(gunbird.locator('.cover.letter')).toBeVisible();
    await gunbird.click();
    await page.locator('#modal .modal-gear').click();
    const retro = page.locator('#modal-art .arted');
    await expect(retro).toBeVisible();
    await expect(retro.locator('.atile.a-icon figcaption')).toHaveText('박스 아트');
    await expect(retro.locator('.arted-note')).toContainText('박스 아트를 바꿉니다');
    await expect(retro.locator('.atile.a-banner, .arted-shots')).toHaveCount(0);
    await choose(page, retro.locator('.atile.a-icon'), false);
    await expect(page.locator('#modal-art .atile.a-icon img')).toBeVisible();
    await expect(page.locator('#modal-art .atile.a-icon img')).toHaveAttribute('src', /\/boxart\?v=/);
    await page.locator('#modal .modal-x').click();
    // The list behind the window shows the new box art in place of the letter tile.
    await expect(gunbird.locator('img.cover')).toHaveAttribute('src', /\/boxart\?v=.*size=md/);
  } finally {
    await page.request.post('/admin/api/server-settings', { data: { uploadsEnabled: null } });
  }
});

test('an account with the user role sees no picture editor', async ({ page: admin, browser }) => {
  await adminAccount(admin);
  expect((await admin.request.post('/admin/api/users', { data: { ...VIEWER, role: 'user' } })).status()).toBe(201);
  const viewer = await browser.newContext();
  const page = await viewer.newPage();
  await login(page, VIEWER);
  expect((await page.request.get('/api/art/access')).status()).toBe(403);

  await page.goto('/#all');
  await page.locator('#games .game').first().click();
  await expect(page.locator('#modal-title')).toBeVisible();
  await expect(page.locator('#modal .modal-gear')).toBeHidden();
  await expect(page.locator('#modal-art .arted')).toHaveCount(0);
  await page.locator('#modal .modal-x').click();

  await page.goto('/#retro');
  await page.locator('#retro-games .game').first().click();
  await expect(page.locator('#modal-title')).not.toBeEmpty();
  await expect(page.locator('#modal .modal-gear')).toBeHidden();
  await expect(page.locator('#modal-art .arted')).toHaveCount(0);
  await viewer.close();
});
