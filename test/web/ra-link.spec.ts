import { test, expect } from '@playwright/test';
import crypto from 'node:crypto';
import fs from 'node:fs';

// The page and its noble scripts come from the server; the link API is played here,
// with Node's OpenSSL standing in for the console's mbedTLS.
test('the phone page seals the password so only the console opens it, and follows the sign-in', async ({ page }) => {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const code = 'AbCdEfGhIjKlMnOpQrStUv';
  const open = (env: { epk: string; iv: string; ct: string }, aad = code) => {
    const x = ecdh.computeSecret(Buffer.from(env.epk, 'base64url'));
    const key = Buffer.from(crypto.hkdfSync('sha256', x, Buffer.alloc(0), 'cookingfoil-ra-link', 32));
    const body = Buffer.from(env.ct, 'base64url');
    const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(env.iv, 'base64url'));
    d.setAAD(Buffer.from(aad, 'utf8'));
    d.setAuthTag(body.subarray(-16));
    return JSON.parse(Buffer.concat([d.update(body.subarray(0, -16)), d.final()]).toString('utf8'));
  };

  const envelopes: { epk: string; iv: string; ct: string }[] = [];
  const results = ['unreadable', 'wrong', 'done'];
  const requester = { account: 'viewer', device: '<b>Living room</b>' };
  let state = 'waiting', triesLeft = 3;
  await page.route(`**/ra-link/api/${code}*`, async route => {
    const req = route.request();
    if (req.method() === 'POST') {
      envelopes.push(req.postDataJSON());
      state = 'sealed';
      return route.fulfill({ status: 202, json: { state, requester, username: 'Mario', triesLeft, expiresAt: 0 } });
    }
    // The console takes the envelope and answers: one it could not open, a wrong password, then the right one.
    if (new URL(req.url()).searchParams.get('after') === 'sealed') {
      state = results.shift()!;
      if (state === 'wrong') triesLeft--;
    }
    return route.fulfill({ json: { state, requester, username: 'Mario', triesLeft, expiresAt: 0 } });
  });

  await page.setViewportSize({ width: 393, height: 800 });
  await page.goto(`/ra-link?c=${code}&lang=ko#k=${ecdh.getPublicKey().toString('base64url')}`);
  await expect(page.getByRole('heading', { name: '레트로 업적 연결' })).toBeVisible();
  await expect(page.locator('#http-warn')).toBeVisible();
  // Who asked, as plain text (a console name is the user's own words).
  await expect(page.locator('#ask-who')).toHaveText("viewer 계정의 기기 '<b>Living room</b>' 가 요청했습니다.");
  await expect(page.locator('#ask')).toContainText('지금 내가 기기에 띄운 QR 이 아니면');
  await expect(page.locator('#username')).toHaveValue('Mario');
  await expect(page.locator('#password')).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  fs.mkdirSync('out/web', { recursive: true });
  await page.screenshot({ path: 'out/web/ra-link-phone.png' });

  await page.locator('#password').fill('first-try');
  await page.locator('#send').click();
  await expect(page.locator('#msg')).toHaveText('기기가 받은 내용을 풀지 못했습니다. 다시 입력합니다. 남은 횟수는 줄지 않았습니다.');
  await page.locator('#password').fill('first-try');
  await page.locator('#send').click();
  await expect(page.locator('#msg')).toHaveText('비밀번호가 맞지 않습니다. 다시 입력합니다. (남은 횟수 2번)');
  await expect(page.locator('#password')).toHaveValue('');
  expect(open(envelopes[0])).toEqual({ u: 'Mario', p: 'first-try' });
  expect(() => open(envelopes[0], 'another-code')).toThrow();

  await page.locator('#password').fill('pässwörd 🔑');
  await page.locator('#send').click();
  await expect(page.locator('#msg')).toHaveText('연결했습니다. 이제 기기에서 업적이 쌓입니다. 이 창은 닫아도 됩니다.');
  await expect(page.locator('#form')).toBeHidden();
  expect(open(envelopes[2])).toEqual({ u: 'Mario', p: 'pässwörd 🔑' });
  expect(envelopes[2].epk).not.toBe(envelopes[1].epk);
});

test('a QR without the console key, or a gone link, says so instead of taking a password', async ({ page }) => {
  await page.goto('/ra-link?c=whatever&lang=en');
  await expect(page.locator('#msg')).toHaveText("The QR address is incomplete. Scan the console's QR again.");
  await expect(page.locator('#form')).toBeHidden();
  const key = crypto.createECDH('prime256v1');
  key.generateKeys();
  await page.goto(`/ra-link?c=gone&lang=en#k=${key.getPublicKey().toString('base64url')}`);
  await expect(page.locator('#msg')).toHaveText('This QR has expired. Show the QR on the console again.');
});

test('when the console gives up on its own side, the phone says to look at the console, not that the password was wrong', async ({ page }) => {
  const key = crypto.createECDH('prime256v1');
  key.generateKeys();
  let state = 'waiting';
  await page.route('**/ra-link/api/stopcode*', route => {
    if (route.request().method() === 'POST') { state = 'sealed'; return route.fulfill({ status: 202, json: { state, triesLeft: 3 } }); }
    if (new URL(route.request().url()).searchParams.get('after') === 'sealed') state = 'stopped';
    return route.fulfill({ json: { state, requester: { account: 'viewer', device: null }, username: null, triesLeft: 3, expiresAt: 0 } });
  });
  await page.goto(`/ra-link?c=stopcode&lang=ko#k=${key.getPublicKey().toString('base64url')}`);
  await expect(page.locator('#ask-who')).toHaveText('viewer 계정의 기기가 요청했습니다.');
  await page.locator('#username').fill('Mario');
  await page.locator('#password').fill('pw');
  await page.locator('#send').click();
  await expect(page.locator('#msg')).toHaveText('기기에서 연결하지 못했습니다. 비밀번호 문제는 아닙니다. 기기 화면의 안내를 확인합니다.');
  await expect(page.locator('#form')).toBeHidden();
});
