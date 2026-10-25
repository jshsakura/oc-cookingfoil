import { test, expect, type Page, type Locator } from '@playwright/test';
import sharp from 'sharp';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// A new picture goes through the crop view first: the admin moves a box held to
// the slot's shape and applies it. The upload is kept, so "다시 자르기" cuts it
// again without another upload, and the lists behind the window show it at once.
// Made when the tests run (not when the file is listed) and taken away after them.
let dir = '';
test.beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-crop-')); });
test.afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

// 800 x 400: the left half red, the right half blue.
async function halves(name: string) {
  const file = path.join(dir, name);
  const blue = await sharp({ create: { width: 400, height: 400, channels: 3, background: '#0000ff' } }).png().toBuffer();
  fs.writeFileSync(file, await sharp({ create: { width: 800, height: 400, channels: 3, background: '#ff0000' } })
    .composite([{ input: blue, left: 400, top: 0 }]).png().toBuffer());
  return file;
}

async function choose(page: Page, tile: Locator, file: string) {
  const chooser = page.waitForEvent('filechooser');
  await tile.locator('.face').click();
  await (await chooser).setFiles(file);
}

async function openEdit(page: Page, modal: string) {
  await page.locator(`${modal} .modal-gear`).click();
  await expect(page.locator(`${modal} .modal-gear`)).toHaveAttribute('aria-pressed', 'true');
}

// Drags the crop box by (dx, dy) screen pixels with the mouse.
async function dragBox(page: Page, crop: Locator, dx: number, dy = 0) {
  const b = (await crop.locator('.crop-box').boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2 + dy, { steps: 6 });
  await page.mouse.up();
}

const lastToast = (page: Page) => page.locator('#toasts .toast').last();

test('an admin crops a homebrew icon on upload, crops it again, and the list shows it at once', async ({ page }) => {
  const pic = await halves('wide.png');
  await page.addInitScript(() => { try { localStorage.setItem('cookingfoil:lang', 'ko'); } catch { /* none */ } });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#tools');
  const app = (await (await page.request.get('/api/homebrew?with=titles')).json()).homebrew.find((a: { name: string }) => a.name === 'Hand App');
  const row = page.locator('#tools-list .xrow', { hasText: 'Hand App' });
  const rowImg = row.locator('img').first();
  const before = await rowImg.getAttribute('src');
  await row.click();
  await openEdit(page, '#xmodal');
  const card = page.locator('#xm-art .arted');

  // Cancelling leaves everything as it was: nothing is sent.
  await choose(page, card.locator('.atile.a-banner'), pic);
  const crop = card.locator('.crop');
  await expect(crop).toBeVisible();
  await expect(crop.locator('.crop-head h4')).toHaveText('남길 부분을 고릅니다');
  await expect(card.locator('.atile.a-icon')).toBeHidden();
  await crop.getByRole('button', { name: '취소' }).click();
  await expect(crop).toHaveCount(0);
  await expect(card.locator('.atile.a-banner .reset')).toHaveCount(0);

  // The icon: a square box over a wide picture, dragged to the right half.
  await choose(page, card.locator('.atile.a-icon'), pic);
  await expect(crop.locator('.crop-box')).toBeVisible();
  const box = (await crop.locator('.crop-box').boundingBox())!;
  expect(Math.abs(box.width - box.height)).toBeLessThan(2);
  await dragBox(page, crop, 400);
  fs.mkdirSync('out/web', { recursive: true });
  await page.screenshot({ path: 'out/web/art-crop-390.png' });
  await crop.getByRole('button', { name: '적용' }).click();
  await expect(lastToast(page)).toContainText('변경했습니다');
  let st = await (await page.request.get(`/api/art/homebrew/${app.id}`)).json();
  expect(st.originals.icon.x).toBeGreaterThan(0.45);
  expect(st.originals.icon.w).toBeCloseTo(0.5, 2);
  const afterUpload = await rowImg.getAttribute('src');
  expect(afterUpload).not.toBe(before);
  expect(afterUpload).toBe(st.icon);

  // Again, from the kept original: the keyboard moves the box to the left half.
  await page.locator('#xm-art .atile.a-icon .recrop').click();
  await expect(crop.locator('.crop-box')).toBeVisible();
  await crop.locator('.crop-box').focus();
  for (let i = 0; i < 6; i++) await page.keyboard.press('Shift+ArrowLeft');
  await crop.getByRole('button', { name: '적용' }).click();
  await expect(lastToast(page)).toContainText('다시 잘랐습니다');
  st = await (await page.request.get(`/api/art/homebrew/${app.id}`)).json();
  expect(st.originals.icon.x).toBeLessThan(0.01);
  await expect(rowImg).toHaveAttribute('src', st.icon);
  expect(st.icon).not.toBe(afterUpload);

  // The corner button puts the app's own icon back and the kept original goes with it.
  await page.locator('#xm-art .atile.a-icon .reset').click();
  await expect(page.locator('#xm-art .atile.a-icon .recrop')).toHaveCount(0);
  st = await (await page.request.get(`/api/art/homebrew/${app.id}`)).json();
  expect(st.originals.icon).toBeNull();
  expect((await page.request.get(`/api/art/homebrew/${app.id}/icon/original`)).status()).toBe(404);
});

test('a game banner is cropped with a corner handle, cropped again, and the grid card follows its icon', async ({ page }) => {
  const pic = await halves('game.png');
  await page.addInitScript(() => { try { localStorage.setItem('cookingfoil:lang', 'ko'); } catch { /* none */ } });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/#all');
  const game = page.locator('#games .game').first();
  const cover = game.locator('img.cover');
  const before = await cover.getAttribute('src');
  const base = (await cover.getAttribute('data-art'))!.match(/\/api\/library\/icon\/([0-9A-F]{16})/)![1];
  await game.click();
  await openEdit(page, '#modal');
  const card = page.locator('#modal-art .arted');

  // The banner: a 16:9 box, made smaller from its bottom-right corner.
  await choose(page, card.locator('.atile.a-banner'), pic);
  const crop = card.locator('.crop');
  await expect(crop.locator('.crop-box')).toBeVisible();
  const b = (await crop.locator('.crop-box').boundingBox())!;
  expect(b.width / b.height).toBeCloseTo(16 / 9, 1);
  const se = (await crop.locator('.crop-h.se').boundingBox())!;
  await page.mouse.move(se.x + se.width / 2, se.y + se.height / 2);
  await page.mouse.down();
  await page.mouse.move(se.x - b.width / 2, se.y - b.height / 2, { steps: 6 });
  await page.mouse.up();
  const small = (await crop.locator('.crop-box').boundingBox())!;
  expect(small.width).toBeLessThan(b.width * 0.7);
  expect(small.width / small.height).toBeCloseTo(16 / 9, 1);
  await crop.getByRole('button', { name: '적용' }).click();
  await expect(lastToast(page)).toContainText('변경했습니다');
  let art = await (await page.request.get(`/api/art/${base}`)).json();
  expect(art.originals.banner.w).toBeLessThan(0.7);

  // The icon, as it comes: the grid card behind the window shows the new one without a reload.
  await choose(page, page.locator('#modal-art .atile.a-icon'), pic);
  await page.locator('#modal-art .crop').getByRole('button', { name: '적용' }).click();
  await expect(lastToast(page)).toContainText('변경했습니다');
  await expect.poll(() => cover.getAttribute('src')).not.toBe(before);
  art = await (await page.request.get(`/api/art/${base}`)).json();
  expect(await cover.getAttribute('src')).toContain(art.urls.icon.split('?')[1]);

  // Cropping the banner again starts from the area saved, and the address of the icon stays.
  await page.locator('#modal-art .atile.a-banner .recrop').click();
  const again = page.locator('#modal-art .crop');
  await expect(again.locator('.crop-box')).toBeVisible();
  const kept = (await again.locator('.crop-box').boundingBox())!;
  expect(kept.width).toBeLessThan(b.width * 0.7);
  await dragBox(page, again, 200, 100);
  await again.getByRole('button', { name: '적용' }).click();
  await expect(lastToast(page)).toContainText('다시 잘랐습니다');
  const next = await (await page.request.get(`/api/art/${base}`)).json();
  expect(next.originals.banner.x).toBeGreaterThan(art.originals.banner.x);

  // Reset takes both out.
  await page.locator('#modal-art .atile.a-banner .reset').click();
  await expect(lastToast(page)).toContainText('뺐습니다');
  await page.locator('#modal-art .atile.a-icon .reset').click();
  await expect(lastToast(page)).toContainText('뺐습니다');
  const done = await (await page.request.get(`/api/art/${base}`)).json();
  expect(done.originals.banner).toBeNull();
  expect(done.originals.icon).toBeNull();
  // No icon at all now: the card falls back to its placeholder, holding the new address for the next upload.
  await expect.poll(() => cover.getAttribute('data-art')).toContain(done.urls.icon.split('?')[1]);
});
