import { test, expect } from '@playwright/test';
import { generate } from 'otplib';
import crypto from 'node:crypto';
import fs from 'node:fs';

test('phone QR approval authenticates, confirms the device, and connects it', async ({ page, request }) => {
  await page.setViewportSize({ width:390, height:844 });
  const headers = { 'X-Device-Key': crypto.randomBytes(32).toString('hex') };
  const pending = await (await request.get('/api/pair/status', { headers })).json();
  expect(pending.status).toBe('pending');
  await page.goto(pending.pairUrl);
  await expect(page.getByRole('heading', { name:'샵 연결', exact:true })).toBeVisible();
  await expect(page.locator('.device-code')).toHaveText(pending.pairCode);
  await expect(page.locator('#approve')).toHaveCount(0);
  await page.locator('#code').fill('000000');
  await page.getByRole('button', { name:'인증합니다', exact:true }).click();
  await expect(page.locator('#error')).toHaveText('관리자 인증을 확인합니다.');
  fs.mkdirSync('out/web', { recursive:true });
  await page.locator('#code').fill('');
  await page.screenshot({ path:'out/web/pairing-login-mobile.png' });
  await page.locator('#code').fill(await generate({ secret:'KRSXG5CTMVRXEZLUKRSXG5CTMVRXEZLU' }));
  await page.getByRole('button', { name:'인증합니다', exact:true }).click();
  await expect(page.locator('#approve')).toBeVisible();
  await page.locator('#label').fill('Nintendo Switch');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path:'out/web/pairing-confirm-mobile.png' });
  await page.getByRole('button', { name:'이 기기를 연결합니다', exact:true }).click();
  await expect(page.getByRole('heading', { name:'샵 연결을 승인했습니다.', exact:true })).toBeVisible();
  await page.screenshot({ path:'out/web/pairing-complete-mobile.png' });
  const approved = await (await request.get('/api/pair/status', { headers })).json();
  expect(approved.status).toBe('approved');
  expect(approved.accessKey).toBeTruthy();
  const response = await request.get('/api/shop/sections', { headers:{ ...headers, 'X-Access-Key':approved.accessKey } });
  expect(response.ok()).toBeTruthy();
});

test('a configuration file can be downloaded without exposing authentication secrets', async ({ request }) => {
  const response = await request.get('/api/client-config');
  expect(response.headers()['content-disposition']).toContain('config.json');
  const configuration = await response.json();
  expect(configuration.servers).toHaveLength(1);
  expect(configuration.servers[0].url).toBe('http://127.0.0.1:3188');
  expect(configuration.servers[0].password).toBe('');
  expect(configuration.servers[0].cfClientSecret).toBe('');
  expect(configuration.language).toBe('ko');
  expect(configuration.installTarget).toBe('sd');
  expect(configuration).not.toHaveProperty('accessKeys');
});
