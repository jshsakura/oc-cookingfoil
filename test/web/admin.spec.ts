import { test, expect, type Page } from '@playwright/test';
import { generate } from 'otplib';
import fs from 'node:fs';

const SECRET = 'KRSXG5CTMVRXEZLUKRSXG5CTMVRXEZLU';
const NAME = 'e2e-user';
const PASSWORD = 'e2e-password-123';
const basic = (user: string, pass: string) => ({ Authorization: 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64') });

let adminCookie = '';

async function signIn(page: Page) {
  await page.goto('/admin?enrolled=1');
  await page.getByLabel('인증 코드').fill(await generate({ secret: SECRET }));
  await page.getByRole('button', { name: '들어가기', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'CookingFoil 관리', exact: true })).toBeVisible();
  const cookies = await page.context().cookies();
  adminCookie = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

// The browser carries the account it is about to create, so once the password
// lane switches on it keeps answering the challenge like a signed-in operator.
test.use({ httpCredentials: { username: NAME, password: PASSWORD } });

test('an account created in the admin page works for basic auth, and removing it reopens the server', async ({ page, request }) => {
  page.on('dialog', (dialog) => dialog.accept());
  await signIn(page);
  fs.mkdirSync('out/web', { recursive: true });
  await page.screenshot({ path: 'out/web/admin-overview.png' });

  await page.getByRole('link', { name: '사용자' }).click();
  await page.getByLabel('사용자 이름').fill(NAME);
  await page.getByLabel('비밀번호').fill(PASSWORD);
  await page.getByRole('button', { name: '사용자 추가', exact: true }).click();

  const dialog = page.locator('#cred-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(PASSWORD);
  await page.screenshot({ path: 'out/web/admin-credential.png' });
  await dialog.getByRole('button', { name: '닫기', exact: true }).click();

  expect((await request.get('/shop.tfl', { headers: basic(NAME, 'wrong-password') })).status()).toBe(401);
  expect((await request.get('/shop.tfl', { headers: basic(NAME, PASSWORD) })).status()).toBe(200);

  // The page itself now signs in with this account, so it already shows as in use.
  const row = page.locator('#users tr', { hasText: NAME });
  await expect(row).toContainText('사용 중');
  await page.screenshot({ path: 'out/web/admin-users.png' });
  await row.getByRole('button', { name: '삭제', exact: true }).click();
  await expect(page.locator('#users')).toContainText('아직 사용자가 없습니다');
  expect((await request.get('/shop.tfl')).status()).toBe(200);
});

// Whatever happened above, leave the server without accounts for the other specs.
test.afterEach(async ({ request }) => {
  await request.delete(`/admin/api/users/${NAME}?allowEmpty=1`, { headers: { Cookie: adminCookie } }).catch(() => {});
});

test('library tab shows the catalog state and starts a rescan', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: '라이브러리' }).click();
  await expect(page.locator('#settings')).toContainText('버전');
  await page.getByRole('button', { name: '다시 스캔', exact: true }).click();
  await expect(page.locator('#toast')).toContainText('다시 스캔을 시작했습니다');
});

test('admin API refuses changes without a session', async ({ request }) => {
  const response = await request.post('/admin/api/users', { data: { name: 'intruder' } });
  expect(response.status()).toBe(401);
});
