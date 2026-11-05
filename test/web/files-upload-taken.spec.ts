import { test, expect } from '@playwright/test';
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
