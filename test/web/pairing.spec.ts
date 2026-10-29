import { test, expect } from '@playwright/test';
import { freshCode } from './admin-sign-in';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { shot } from './shots';

test('phone QR approval authenticates, confirms the device, and connects it', async ({ page, request }) => {
  await page.setViewportSize({ width:390, height:844 });
  const headers = { 'X-Device-Key': crypto.randomBytes(32).toString('hex') };
  const pending = await (await request.get('/api/pair/status', { headers })).json();
  expect(pending.status).toBe('pending');
  await page.goto(pending.pairUrl);
  await expect(page.getByRole('heading', { name:'서버 연결', exact:true })).toBeVisible();
  await expect(page.locator('.device-code')).toHaveText(pending.pairCode);
  await expect(page.locator('#approve')).toHaveCount(0);
  await page.locator('#code').fill('000000');
  await page.getByRole('button', { name:'인증합니다', exact:true }).click();
  await expect(page.locator('#error')).toHaveText('관리자 코드를 확인한 뒤 다시 시도합니다.');
  fs.mkdirSync('out/web', { recursive:true });
  await page.locator('#code').fill('');
  await shot(page, { path:'out/web/pairing-login-mobile.png' });
  await page.locator('#code').fill(await freshCode());
  await page.getByRole('button', { name:'인증합니다', exact:true }).click();
  await expect(page.locator('#approve')).toBeVisible();
  await page.locator('#label').fill('Living room');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await shot(page, { path:'out/web/pairing-confirm-mobile.png' });
  await page.getByRole('button', { name:'이 기기를 연결합니다', exact:true }).click();
  await expect(page.getByRole('heading', { name:'서버 연결을 승인했습니다.', exact:true })).toBeVisible();
  await shot(page, { path:'out/web/pairing-complete-mobile.png' });
  const approved = await (await request.get('/api/pair/status', { headers })).json();
  expect(approved.status).toBe('approved');
  expect(approved.accessKey).toBeTruthy();
  const response = await request.get('/api/library/sections', { headers:{ ...headers, 'X-Access-Key':approved.accessKey } });
  expect(response.ok()).toBeTruthy();
});

test('a configuration file can be downloaded without exposing authentication secrets', async ({ request }) => {
  const response = await request.get('/api/client-config', { headers: { 'Accept-Language': 'ko-KR,ko;q=0.9' } });
  expect(response.headers()['content-disposition']).toContain('config.json');
  const configuration = await response.json();
  expect(configuration.servers).toHaveLength(1);
  expect(configuration.servers[0].url).toBe(`http://127.0.0.1:${process.env.COOK_WEB_TEST_PORT}`);
  // named after the library's host, in the downloader's language
  expect(configuration.servers[0].title).toBe('127.0.0.1');
  expect(configuration.servers[0].password).toBe('');
  expect(configuration.servers[0].cfClientSecret).toBe('');
  expect(configuration.language).toBe('ko');
  expect(configuration.installTarget).toBe('sd');
  expect(configuration).not.toHaveProperty('accessKeys');
});

test('/pair lays connecting and my consoles side by side on a desktop and stacks them on a phone', async ({ page, request }) => {
  const { signIn } = await import('./admin-sign-in');
  const { removeAccount } = await import('./web-session');
  const NAME = 'pair-e2e', PASSWORD = 'pair-password-123';
  await page.setViewportSize({ width:1440, height:900 });
  const adminCookie = await signIn(page);
  expect((await page.request.post('/admin/api/users', { data:{ name:NAME, password:PASSWORD }, headers:{ Origin:new URL(page.url()).origin } })).status()).toBe(201);
  try {
  await page.goto('/login?next=/pair');
  await page.getByLabel(/^(아이디|Username)$/).fill(NAME);
  await page.getByLabel(/^(비밀번호|Password)$/).fill(PASSWORD);
  await page.getByRole('button', { name:/^(로그인|Sign in)$/ }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  const headers = { 'X-Device-Key': crypto.randomBytes(32).toString('hex') };
  const pending = await (await request.get('/api/pair/status', { headers })).json();
  await page.goto('/pair?lang=ko');
  const connect = page.getByRole('region', { name:'새 기기 연결' });
  const mine = page.getByRole('region', { name:/^내 기기/ });
  await expect(connect).toBeVisible();
  await expect(mine).toBeVisible();
  const [a, b] = [await connect.boundingBox(), await mine.boundingBox()];
  expect(b!.x).toBeGreaterThan(a!.x + a!.width - 1);
  await page.locator('#code').fill(pending.pairCode);
  await page.locator('#label').fill('Desk console');
  await page.getByRole('button', { name:'이 기기를 연결합니다', exact:true }).click();
  const row = mine.getByRole('listitem').filter({ hasText:'Desk console' });
  await expect(row).toBeVisible();
  await expect(row).toContainText(`코드 ${pending.pairCode}`);
  await row.getByRole('button', { name:'이름 변경' }).click();
  await page.locator('#ask-input').fill('Den console');
  await page.locator('#ask-ok').click();
  await expect(mine.getByRole('listitem').filter({ hasText:'Den console' })).toBeVisible();
  fs.mkdirSync('out/web', { recursive:true });
  await shot(page, { path:'out/web/pair-desktop.png', fullPage:true });

  await page.setViewportSize({ width:390, height:844 });
  await expect.poll(async () => {
    const [c, d] = [await connect.boundingBox(), await mine.boundingBox()];
    return d!.y - (c!.y + c!.height - 1);
  }, { message: 'on a phone the list sits under the connect card' }).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth), { message: 'no sideways scroll on a phone' }).toBeLessThanOrEqual(390);
  await shot(page, { path:'out/web/pair-mobile.png', fullPage:true });

  const den = mine.getByRole('listitem').filter({ hasText:'Den console' });
  await den.getByRole('button', { name:'연결 해제' }).click();
  await page.locator('#ask-no').click();
  await expect(den).toBeVisible();
  await den.getByRole('button', { name:'연결 해제' }).click();
  await page.locator('#ask-ok').click();
  await expect(den).toHaveCount(0);
  } finally {
    await removeAccount(request, NAME, PASSWORD, adminCookie);
  }
});

test('the client download button says it is preparing the file, then that the download started', async ({ page, request }) => {
  const { signIn } = await import('./admin-sign-in');
  const { removeAccount } = await import('./web-session');
  const NAME = 'dl-feedback-e2e', PASSWORD = 'dl-feedback-password-123';
  const adminCookie = await signIn(page);
  expect((await page.request.post('/admin/api/users', { data:{ name:NAME, password:PASSWORD }, headers:{ Origin:new URL(page.url()).origin } })).status()).toBe(201);
  try {
    await page.goto('/login?next=/pair');
    await page.getByLabel(/^(아이디|Username)$/).fill(NAME);
    await page.getByLabel(/^(비밀번호|Password)$/).fill(PASSWORD);
    await page.getByRole('button', { name:/^(로그인|Sign in)$/ }).click();
    await page.waitForURL((u) => !u.pathname.startsWith('/login'));
    await page.route('**/api/client/latest', (r) => r.fulfill({ json:{ version:'9.9.9', size:1048576 } }));
    let release: () => void = () => {};
    const held = new Promise<void>((done) => { release = done; });
    await page.route('**/pair/api/client-bundle', async (r) => { await held;
      await r.fulfill({ body:Buffer.from('PK'), headers:{ 'Content-Type':'application/zip', 'Content-Disposition':'attachment; filename="CookingFoil.zip"' } }); });
    await page.goto('/pair?lang=ko');
    const button = page.locator('#get-client');
    await expect(button).toHaveText('클라이언트 다운로드');
    await button.click();
    await expect(button).toHaveText('파일을 준비하고 있습니다…');
    await expect(button).toBeDisabled();
    release();
    await expect(button).toHaveText('다운로드를 시작했습니다');
    await expect(button).toHaveText('클라이언트 다운로드', { timeout:6000 });
    await expect(button).toBeEnabled();
  } finally {
    await removeAccount(request, NAME, PASSWORD, adminCookie);
  }
});
