import { test, expect, type Page } from '@playwright/test';
import { generate } from 'otplib';
import fs from 'node:fs';
import { acceptAsks } from './ask';

// The share inbox end to end: a signed-in user leaves files, a note and links
// from the account menu, and the admin finds them in the 임시 공유 tab.
const SECRET = 'KRSXG5CTMVRXEZLUKRSXG5CTMVRXEZLU';
const NAME = 'inbox-user';
const PASSWORD = 'inbox-password-123';
let adminCookie = '';

async function adminSignIn(page: Page) {
  await page.goto('/admin?enrolled=1');
  await page.getByLabel('인증 앱 코드').fill(await generate({ secret: SECRET }));
  await page.getByRole('button', { name: '들어가기', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'CookingFoil 관리', exact: true })).toBeVisible();
  adminCookie = (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; ');
}

test.afterEach(async ({ request }) => {
  const basic = 'Basic ' + Buffer.from(`${NAME}:${PASSWORD}`).toString('base64');
  await request.delete(`/admin/api/users/${NAME}?allowEmpty=1`, { headers: { Cookie: adminCookie, Authorization: basic } }).catch(() => {});
});

test('signed-out visitors are not offered the share inbox', async ({ page }) => {
  await page.goto('/');
  await page.locator('#acct-btn').click();
  await expect(page.locator('#acct-list a[href="/admin"]')).toBeVisible();
  await expect(page.locator('#inbox-link')).toBeHidden();
  expect((await page.request.get('/api/inbox')).status()).toBe(401);
});

test('a signed-in user shares files, a note and links, and the admin sorts them in the 임시 공유 tab', async ({ page }) => {
  await acceptAsks(page);
  await adminSignIn(page);
  expect((await page.request.post('/admin/api/users', { data: { name: NAME, password: PASSWORD, role: 'admin' } })).status()).toBe(201);

  await page.goto('/login');
  await page.getByLabel(/^(아이디|Username)$/).fill(NAME);
  await page.getByLabel(/^(비밀번호|Password)$/).fill(PASSWORD);
  await page.getByRole('button', { name: /^(로그인|Sign in)$/ }).click();
  await page.evaluate(() => localStorage.setItem('cookingfoil:lang', 'ko'));
  await page.goto('/');
  await page.locator('#acct-btn').click();
  await page.getByRole('menuitem', { name: '임시 공유' }).click();
  const modal = page.locator('#share-modal');
  await expect(modal).toHaveClass(/open/);

  // nothing given, then a link that isn't http(s): told before anything is sent
  await modal.getByRole('button', { name: '보내기' }).click();
  await expect(page.locator('#share-msg')).toHaveText('파일, 메모, 링크 중 하나는 남깁니다.');
  await page.locator('#share-links').fill('javascript:alert(1)');
  await modal.getByRole('button', { name: '보내기' }).click();
  await expect(page.locator('#share-msg')).toHaveText('http 나 https 로 시작하는 주소만 남깁니다.');

  await page.locator('#share-files').setInputFiles([
    { name: '세이브 백업.zip', mimeType: 'application/zip', buffer: Buffer.from('zip bytes') },
    { name: 'readme.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') },
  ]);
  await expect(page.locator('#share-chosen')).toContainText('파일 2개');
  await page.locator('#share-memo').fill('피크민 4 세이브입니다\n엔딩 직전입니다');
  await page.locator('#share-links').fill('https://example.com/post/1\nhttp://example.org/mirror');
  fs.mkdirSync('out/web', { recursive: true });
  await modal.locator('.modal').screenshot({ path: 'out/web/share-form.png' });
  await modal.getByRole('button', { name: '보내기' }).click();
  await expect(page.locator('#share-msg')).toHaveText('보냈습니다. 관리자에게 알렸습니다.');
  await expect(page.locator('#share-chosen')).toContainText('고른 파일이 없습니다');

  await page.goto('/admin#inbox');
  const entry = page.locator('#ib-list .ib-entry').first();
  await expect(entry).toContainText(NAME);
  await expect(entry.locator('.ib-memo')).toHaveText('피크민 4 세이브입니다\n엔딩 직전입니다');
  const link = entry.getByRole('link', { name: 'https://example.com/post/1' });
  await expect(link).toHaveAttribute('rel', /noopener/);
  await expect(link).toHaveAttribute('target', '_blank');
  const file = entry.getByRole('link', { name: '세이브 백업.zip' });
  const download = await (await page.request.get((await file.getAttribute('href'))!)).text();
  expect(download).toBe('zip bytes');
  await expect(page.locator('#inbox-count')).toHaveText('1');
  await page.screenshot({ path: 'out/web/admin-inbox.png' });

  await entry.getByRole('button', { name: '정리함으로' }).click();
  await expect(page.locator('#ib-list')).toContainText('남긴 것이 없습니다.');
  await page.locator('#ib-show').getByRole('button', { name: '정리함' }).click();
  const done = page.locator('#ib-list .ib-entry');
  await expect(done).toHaveCount(1);
  await done.getByRole('button', { name: '삭제' }).click();
  await expect(page.locator('#ib-list')).toContainText('정리함이 비어 있습니다.');
});

test('the settings tab switches the inbox and sets its sizes in GB', async ({ page }) => {
  await adminSignIn(page);
  await page.goto('/admin#settings');
  const max = page.locator('.ss-row[data-key="inboxMaxBytes"] input');
  await expect(max).toHaveValue('2');
  await max.fill('0.5');
  await max.press('Tab');
  await expect(page.locator('.ss-row[data-key="inboxMaxBytes"] .ss-src')).toContainText('compose 값은 2 GB');
  const settings = await (await page.request.get('/admin/api/server-settings')).json();
  expect(settings.settings.inboxMaxBytes.value).toBe(512 * 1024 ** 2);
  await page.locator('.ss-row[data-key="inboxMaxBytes"] .ss-src').getByRole('button', { name: 'compose 값으로' }).click();
  await expect(page.locator('.ss-row[data-key="inboxMaxBytes"] .ss-src')).toHaveCount(0);
  await expect(page.locator('.ss-row[data-key="inboxEnabled"] input')).toBeChecked();
});
