import { test, expect, devices } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { signIn } from './admin-sign-in';

const games = process.env.COOK_GAMES_DIR!;
const base = path.join(games, 'fb-taken');
const put = (rel: string, body = 'x') => {
  fs.mkdirSync(path.dirname(path.join(base, rel)), { recursive: true });
  fs.writeFileSync(path.join(base, rel), body);
};
const read = (rel: string) => fs.readFileSync(path.join(base, rel), 'utf8');
const has = (rel: string) => fs.existsSync(path.join(base, rel));
const row = (page: import('@playwright/test').Page, name: string) => page.locator('#fb-rows tr', { has: page.getByText(name, { exact: true }) });
const pickFile = (page: import('@playwright/test').Page, name: string, body: string) =>
  page.locator('#fb-file').setInputFiles([{ name, mimeType: 'text/plain', buffer: Buffer.from(body) }]);

// A PNG of any size, all one colour: enough for the viewer to measure.
function png(w: number, h: number) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t: string, d: Buffer) => { const type = Buffer.from(t); const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(Buffer.concat([type, d]))); return Buffer.concat([len, type, d, sum]); };
  const head = Buffer.alloc(13); head.writeUInt32BE(w, 0); head.writeUInt32BE(h, 4); head[8] = 8; head[9] = 0;
  const raw = Buffer.alloc((w + 1) * h, 120);
  for (let y = 0; y < h; y++) raw[y * (w + 1)] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

test.beforeEach(async ({ page }) => {
  fs.rmSync(base, { recursive: true, force: true });
  put('same.txt', 'old');
  put('Inner/in.txt');
  put('Bulk/a.txt'); put('Bulk/b.txt'); put('Bulk/c.txt');
  fs.mkdirSync(path.join(base, 'Target'));
  await signIn(page);
  await page.goto('/admin/games?tab=folder&path=fb-taken');
  await expect(row(page, 'same.txt')).toBeVisible();
});
test.afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

test('a name already there asks: skip keeps the old, keep both numbers the new', async ({ page }) => {
  await pickFile(page, 'same.txt', 'new');
  const ask = page.locator('#ask-dialog');
  await expect(ask).toContainText('same.txt');
  await page.locator('#ask-select').selectOption('skip');
  await page.locator('#ask-ok').click();
  await expect(page.locator('#toast')).toContainText('건너뛰었습니다');
  expect(read('same.txt')).toBe('old');

  await page.locator('#fb-up-close').click();
  await pickFile(page, 'same.txt', 'second');
  await page.locator('#ask-select').selectOption('keep');
  await page.locator('#ask-ok').click();
  await expect(row(page, 'same (2).txt')).toBeVisible();
  expect(read('same.txt')).toBe('old');
  expect(read('same (2).txt')).toBe('second');
});

test('replacing sends the old file to the trash, and one undo puts it back', async ({ page }) => {
  await pickFile(page, 'same.txt', 'new');
  await page.locator('#ask-select').selectOption('replace');
  await page.locator('#ask-ok').click();
  await expect.poll(() => read('same.txt')).toBe('new');
  await expect(page.locator('#toast .toast-act')).toBeVisible();
  await page.locator('#toast .toast-act').click();
  await expect.poll(() => has('same.txt') && read('same.txt')).toBe('old');
});

test('an upload is a step: its undo sends the new file to the trash', async ({ page }) => {
  await pickFile(page, 'fresh.txt', 'body');
  await expect(row(page, 'fresh.txt')).toBeVisible();
  await page.keyboard.press('Control+z');
  await expect.poll(() => has('fresh.txt')).toBe(false);
});

test('files from the computer dropped on a folder row land in that folder and the tip says so', async ({ page }) => {
  const dt = await page.evaluateHandle(() => { const d = new DataTransfer(); d.items.add(new File(['drop'], 'dropped.txt', { type: 'text/plain' })); return d; });
  const target = row(page, 'Target');
  await target.dispatchEvent('dragenter', { dataTransfer: dt });
  await target.dispatchEvent('dragover', { dataTransfer: dt });
  await expect(page.locator('#fb-dragtip')).toContainText('Target 폴더에 올립니다');
  await target.dispatchEvent('drop', { dataTransfer: dt });
  await expect.poll(() => has('Target/dropped.txt')).toBe(true);
  expect(has('dropped.txt')).toBe(false);
  await expect(page.locator('#fb-dragtip')).toBeHidden();
});

test('a row dragged with the mouse onto a folder in the tree moves there', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload();
  await page.locator('#fb-t-tree').click();
  const target = page.locator('#fb-tree').getByRole('button', { name: 'Target', exact: true });
  await expect(target).toBeVisible();
  const from = await row(page, 'same.txt').boundingBox();
  const to = await target.boundingBox();
  await page.mouse.move(from!.x + 80, from!.y + from!.height / 2);
  await page.mouse.down();
  await page.mouse.move(from!.x + 90, from!.y + from!.height / 2 + 6, { steps: 3 });
  await page.mouse.move(to!.x + 10, to!.y + to!.height / 2, { steps: 8 });
  await page.mouse.move(to!.x + 14, to!.y + to!.height / 2);
  await expect(page.locator('#fb-dragtip')).toContainText('Target');
  await page.mouse.up();
  await expect.poll(() => has('Target/same.txt')).toBe(true);
});

test('trashing a folder says how many files go with it', async ({ page }) => {
  await row(page, 'Bulk').locator('input[type=checkbox]').check();
  await page.locator('#fb-trash-btn').click();
  await expect(page.locator('#ask-dialog')).toContainText('파일 3개');
  await page.locator('#ask-no').click();
});

test('a stopped upload is not counted as finished', async ({ page }) => {
  await page.route('**/admin/api/upload/chunks/**', () => { /* the piece never lands, so the upload stays stoppable */ });
  await pickFile(page, 'stopped.txt', 'body');
  await page.locator('#fb-up-stop').click();
  await expect(page.locator('#fb-up')).toHaveText('0개를 올렸습니다. 1개는 올리지 않았습니다');
});

test('a picture shrunk to fit opens at its own size with a tap, and back', async ({ page }) => {
  fs.writeFileSync(path.join(base, 'wide.png'), png(2400, 120));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await row(page, 'wide.png').click({ position: { x: 120, y: 10 } });
  const img = page.locator('#fb-v-body img');
  await expect(img).toBeVisible();
  await expect(page.locator('#fb-v-note')).toHaveText('사진을 누르면 원본 크기로 봅니다');
  expect((await img.boundingBox())!.width).toBeLessThan(400);
  await img.click();
  await expect.poll(async () => (await img.boundingBox())!.width).toBe(2400);
  await img.click({ position: { x: 5, y: 5 } });
  await expect.poll(async () => (await img.boundingBox())!.width).toBeLessThan(400);
});

test('a held finger picks a row without opening it, and a slide does not pick', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  const r = row(page, 'same.txt');
  await expect(r).toBeVisible();
  const box = (await r.boundingBox())!;
  const x = box.x + 120, y = box.y + box.height / 2;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  const touch = (type: string, pts: { x: number; y: number }[]) => cdp.send('Input.dispatchTouchEvent', { type: type as 'touchStart', touchPoints: pts });
  await touch('touchStart', [{ x, y }]);
  await touch('touchMove', [{ x, y: y + 40 }]);
  await page.waitForTimeout(650);
  await touch('touchEnd', []);
  await expect(r).toHaveAttribute('aria-selected', 'false');

  await touch('touchStart', [{ x, y }]);
  await expect(r).toHaveAttribute('aria-selected', 'true');
  await touch('touchEnd', []);
  await page.waitForTimeout(100);
  await expect(page.locator('#fb-view')).toBeHidden();
  await expect(r).toHaveAttribute('aria-selected', 'true');
});

test('a bulk move reads as one row on the trash page, which opens to its files', async ({ page }) => {
  await row(page, 'Bulk').getByRole('button', { name: 'Bulk' }).click();
  await expect(row(page, 'a.txt')).toBeVisible();
  await page.locator('#fb-all').check();
  await page.locator('#fb-cut-btn').click();
  await page.locator('#fb-crumb').getByRole('button', { name: 'fb-taken' }).click();
  await row(page, 'Target').getByRole('button', { name: 'Target' }).click();
  await expect(page.locator('#fb-empty')).toBeVisible();
  await page.locator('#fb-paste-btn').click();
  await expect.poll(() => has('Target/c.txt')).toBe(true);
  await page.goto('/admin/trash');
  const many = page.locator('#tr-journal details.tr-jmany').first();
  await expect(many.locator('summary b')).toContainText('3개');
  await many.locator('summary .tr-act button').click();
  await page.locator('#ask-ok').click();
  await expect.poll(() => has('Bulk/c.txt')).toBe(true);
});

test('the chat being off makes no failed request, the alert log shows only the log, and a bad token is said in words', async ({ page }) => {
  const missing: string[] = [];
  page.on('response', (r) => { if (r.status() === 404 && r.url().includes('/api/chat')) missing.push(r.url()); });
  await page.goto('/admin/logs/alerts');
  await expect(page.locator('#al-history')).toBeVisible();
  await expect(page.locator('#al-status')).toBeHidden();
  expect(missing).toEqual([]);
  await page.goto('/admin/settings/notifications');
  await expect(page.locator('#al-status')).toBeVisible();
  await page.locator('#al-form input[name=botToken]').fill('not-a-token');
  await page.locator('#al-form button[type=submit]').click();
  await expect(page.locator('#al-msg')).toHaveText('봇 토큰 형식이 맞지 않습니다');
});

test('a long step says so and shuts its buttons, so the pick cannot go twice', async ({ page }) => {
  let calls = 0;
  await page.route('**/admin/api/files/trash', async (route) => { calls++; await new Promise((r) => setTimeout(r, 1500)); await route.continue(); });
  await row(page, 'same.txt').locator('td.c-size').click();
  await page.locator('#fb-trash-btn').click();
  await page.locator('#ask-ok').click();
  await expect(page.locator('#fb-job')).toContainText('1개를 휴지통으로 옮기는 중입니다');
  await expect(page.locator('#fb-trash-btn')).toBeDisabled();
  await page.keyboard.press('Delete');
  await expect(page.locator('#toast')).toHaveText('아직 하던 일을 마치는 중입니다');
  await expect.poll(() => has('same.txt')).toBe(false);
  await expect(page.locator('#fb-job')).toBeHidden();
  expect(calls).toBe(1);
});

test('Ctrl while dragging copies, and the tip says so', async ({ page }) => {
  const from = (await row(page, 'same.txt').locator('td.c-size').boundingBox())!;
  const to = (await row(page, 'Target').locator('td.c-size').boundingBox())!;
  await page.mouse.move(from.x + 10, from.y + 10);
  await page.mouse.down();
  await page.keyboard.down('Control');
  await page.mouse.move(to.x + 10, to.y + 8, { steps: 6 });
  await page.mouse.move(to.x + 14, to.y + 10);
  await expect(page.locator('#fb-dragtip')).toContainText('Target 폴더로 복사합니다');
  await page.mouse.up();
  await page.keyboard.up('Control');
  await expect.poll(() => has('Target/same.txt')).toBe(true);
  expect(has('same.txt')).toBe(true);
});

test('an upload taken back can be done again, also one that replaced a file', async ({ page }) => {
  await pickFile(page, 'fresh.txt', 'body');
  await expect(row(page, 'fresh.txt')).toBeVisible();
  await page.keyboard.press('Control+z');
  await expect.poll(() => has('fresh.txt')).toBe(false);
  await page.keyboard.press('Control+y');
  await expect.poll(() => has('fresh.txt')).toBe(true);

  await pickFile(page, 'same.txt', 'new');
  await page.locator('#ask-select').selectOption('replace');
  await page.locator('#ask-ok').click();
  await expect.poll(() => has('same.txt') && read('same.txt')).toBe('new');
  await page.keyboard.press('Control+z');
  await expect.poll(() => has('same.txt') && read('same.txt')).toBe('old');
  await page.keyboard.press('Control+y');
  await expect.poll(() => has('same.txt') && read('same.txt')).toBe('new');
  await page.keyboard.press('Control+z');
  await expect.poll(() => has('same.txt') && read('same.txt')).toBe('old');
});

test('ending a share in the properties window takes its row away, the menu ends them all, and a second end is no error', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  const share = () => page.evaluate(() => (window as any).api('/admin/api/files/share', { method: 'POST', body: { root: 'games', path: 'fb-taken/same.txt', hours: 1 } }));
  await share(); await share();
  await page.reload();
  await row(page, 'same.txt').locator('input[type=checkbox]').check();
  await page.locator('#fb-pick-acts').getByRole('button', { name: '파일 메뉴' }).click();
  await page.locator('#fb-menu').getByText('속성').click();
  const links = page.locator('#fb-props .fb-s-link');
  await expect(links).toHaveCount(2);
  await links.first().locator('button').click();
  await expect(links).toHaveCount(1);
  await page.locator('#fb-p-ok').click();
  await page.locator('#fb-pick-acts').getByRole('button', { name: '파일 메뉴' }).click();
  await page.locator('#fb-menu').getByText('공유 링크 끊기').click();
  await expect(page.locator('#ask-dialog')).toContainText('1개');
  await page.locator('#ask-ok').click();
  await expect(page.locator('#toast')).toHaveText('링크를 끊었습니다');
  await expect(row(page, 'same.txt').locator('.fb-shared')).toHaveCount(0);
  const again = await page.evaluate(() => (window as any).api('/admin/api/files/share/end', { method: 'POST', body: { id: 'gone' } }));
  expect(again.ok).toBe(true);
});

test('on a real phone profile a held finger picks a file and a folder, without opening either', async ({ browser, baseURL }) => {
  const { defaultBrowserType: _, ...phone } = devices['iPhone 13'];
  const ctx = await browser.newContext({ ...phone, baseURL });
  const page = await ctx.newPage();
  await signIn(page);
  await page.goto('/admin/games?tab=folder&path=fb-taken');
  const hold = async (name: string) => {
    const r = row(page, name);
    await expect(r).toBeVisible();
    const b = (await r.locator('.fb-name').boundingBox())!;
    const cdp = await ctx.newCDPSession(page);
    const at = [{ x: b.x + 40, y: b.y + b.height / 2 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at });
    await page.waitForTimeout(900);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(r).toHaveAttribute('aria-selected', 'true');
  };
  await hold('same.txt');
  await hold('Target');
  expect(new URL(page.url()).searchParams.get('path')).toBe('fb-taken');
  await expect(page.locator('#fb-view')).toBeHidden();
  await ctx.close();
});

test('on a phone the path steps are thumb sized', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  const step = page.locator('#fb-crumb button').first();
  await expect(step).toBeVisible();
  expect((await step.boundingBox())!.height).toBeGreaterThanOrEqual(44);
});

test('a space in the middle of typing is part of the name, alone it keeps the pick, and Ctrl+Space toggles it', async ({ page }) => {
  put('alpha one.txt'); put('alpha two.txt');
  await page.reload();
  await row(page, 'same.txt').locator('td.c-size').click();
  await page.keyboard.type('alpha t');
  await expect(row(page, 'alpha two.txt')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#fb-rows tr[aria-selected=true]')).toHaveCount(1);
  await page.waitForTimeout(900);
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press(' ');
  await expect(page.locator('#fb-rows tr[aria-selected=true]')).toHaveCount(1);
  await page.keyboard.press('Control+ ');
  await expect(page.locator('#fb-rows tr[aria-selected=true]')).toHaveCount(0);
});

test('Alt with the arrows walks the folders, and the pencil opens the path to type', async ({ page }) => {
  await row(page, 'Target').locator('.fb-name').dblclick();
  await expect.poll(() => new URL(page.url()).searchParams.get('path')).toBe('fb-taken/Target');
  await page.keyboard.press('Alt+ArrowLeft');
  await expect.poll(() => new URL(page.url()).searchParams.get('path')).toBe('fb-taken');
  await page.keyboard.press('Alt+ArrowRight');
  await expect.poll(() => new URL(page.url()).searchParams.get('path')).toBe('fb-taken/Target');
  await page.locator('#fb-addr-btn').click();
  await expect(page.locator('#fb-addr')).toBeVisible();
  await expect(page.locator('#fb-addr')).toHaveValue(/fb-taken\/Target$/);
  await page.keyboard.press('Escape');
  await expect(page.locator('#fb-crumb')).toBeVisible();
});

test('a share can run until a picked day, and no longer than thirty days', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await row(page, 'same.txt').locator('td.c-size').click();
  await row(page, 'same.txt').click({ button: 'right' });
  await page.locator('#fb-menu').getByRole('menuitem', { name: '공유 링크', exact: true }).click();
  await page.locator('#ask-select').selectOption('date');
  await page.locator('#ask-ok').click();
  const day = new Date(Date.now() + 10 * 864e5);
  const ymd = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
  await expect(page.locator('#ask-input')).toHaveAttribute('type', 'date');
  await page.locator('#ask-input').fill(ymd);
  await page.locator('#ask-ok').click();
  await expect(row(page, 'same.txt').locator('.fb-shared')).toHaveCount(1);
  const { shares } = await page.evaluate(() => (window as any).api('/admin/api/files/shares?root=games&path=fb-taken/same.txt'));
  const left = shares[0].expiresAt - Date.now();
  expect(left).toBeGreaterThan(9 * 864e5);
  expect(left).toBeLessThan(11 * 864e5);
  for (const sh of shares) await page.evaluate((id) => (window as any).api('/admin/api/files/share/end', { method: 'POST', body: { id } }), sh.id);
  await page.reload();
  await expect(row(page, 'same.txt')).toBeVisible();
  await page.evaluate(() => (window as any).api('/admin/api/users').then(() => null));
  const refused = await page.evaluate(() => (window as any).api('/admin/api/files/share', { method: 'POST', body: { root: 'games', path: 'fb-taken/same.txt', hours: 721 } }).then(() => null, (e: Error) => e.message));
  expect(refused).toContain('30일');
});

test('on a phone a file with no preview says why it only got picked', async ({ page }) => {
  put('game [0100000000000000][v0].nsp');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await row(page, 'game [0100000000000000][v0].nsp').locator('.fb-name').click();
  await expect(page.locator('#toast')).toContainText('미리 볼 수 없는 파일');
  await expect(row(page, 'game [0100000000000000][v0].nsp')).toHaveAttribute('aria-selected', 'true');
});

test('a folder gets a link too, with a password shown as set', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await row(page, 'Bulk').locator('td.c-size').click();
  await page.locator('#fb-share-btn').click();
  await page.locator('#ask-select').selectOption('1');
  await page.locator('#ask-input').fill('open sesame');
  await page.locator('#ask-ok').click();
  await expect(row(page, 'Bulk').locator('.fb-shared')).toHaveCount(1);
  await page.keyboard.press('Alt+Enter');
  await expect(page.locator('.fb-s-link').first()).toContainText('비밀번호 걸림');
  const { shares } = await page.evaluate(() => (window as any).api('/admin/api/files/shares?root=games&path=fb-taken/Bulk'));
  for (const sh of shares) await page.evaluate((id) => (window as any).api('/admin/api/files/share/end', { method: 'POST', body: { id } }), sh.id);
});

test('a held finger picks wherever on the row it lands', async ({ browser, baseURL }) => {
  const { defaultBrowserType: _, ...phone } = devices['iPhone 13'];
  const ctx = await browser.newContext({ ...phone, baseURL });
  const page = await ctx.newPage();
  await signIn(page);
  await page.goto('/admin/games?tab=folder&path=fb-taken');
  const r = row(page, 'same.txt');
  await expect(r).toBeVisible();
  const b = (await r.boundingBox())!;
  const cdp = await ctx.newCDPSession(page);
  const x = b.x + 220, y = b.y + b.height / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
  await page.waitForTimeout(100);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 2, y: y + 1, id: 1 }] });
  await page.waitForTimeout(700);
  await expect(r).toHaveAttribute('aria-selected', 'true');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await ctx.close();
});

test('a check box pick takes the shortcuts, and a paste into another storage asks first', async ({ page }) => {
  await row(page, 'same.txt').locator('td.c-sel input').check();
  await page.keyboard.press('Control+c');
  await expect(page.locator('#fb-paste-btn')).toBeEnabled();
  await page.goto('/admin/saves?tab=folder');
  await page.locator('#fb-rows').waitFor();
  await page.keyboard.press('Control+v');
  await expect(page.locator('#ask-dialog')).toContainText('게임에서 복사한 1개를');
  await page.locator('#ask-no').click();
  await page.keyboard.press('Escape');
});

test('a stopped upload goes on from its own row', async ({ page }) => {
  let slow = true;
  await page.route('**/admin/api/files/upload/chunks**', async (route) => { if (slow) await new Promise((r) => setTimeout(r, 1500)); await route.continue(); });
  await page.locator('#fb-file').setInputFiles([{ name: 'resume-me.bin', mimeType: 'application/octet-stream', buffer: Buffer.alloc(3 * 1024 * 1024, 7) }]);
  const item = page.locator('#fb-u-list li').filter({ hasText: 'resume-me.bin' });
  await item.getByRole('button', { name: /resume-me.bin/ }).first().click();
  await expect(item).toHaveAttribute('data-state', 'stop');
  slow = false;
  await item.getByRole('button', { name: 'resume-me.bin 이어서 올리기' }).click();
  await expect(item).toHaveAttribute('data-state', 'done');
  await expect(row(page, 'resume-me.bin')).toBeVisible();
  await page.evaluate(() => (window as any).api('/admin/api/files/trash', { method: 'POST', body: { root: 'games', paths: ['fb-taken/resume-me.bin'] } }));
});
