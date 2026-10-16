import { test, expect, type Page } from '@playwright/test';
import sharp from 'sharp';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The artwork editor (admins): games, homebrew and patches share one card. A tile
// takes an image, the corner button puts the original back, the window repaints at once.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-art-'));
async function png(name: string, w: number, h: number, r: number, g: number, b: number) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, await sharp({ create: { width: w, height: h, channels: 3, background: { r, g, b } } }).png().toBuffer());
  return file;
}

async function choose(page: Page, tile: ReturnType<Page['locator']>, file: string) {
  const chooser = page.waitForEvent('filechooser');
  await tile.locator('.face').click();
  await (await chooser).setFiles(file);
}

test('an admin edits a homebrew app and a patch with the same card', async ({ page }) => {
  const icon = await png('icon.png', 512, 512, 230, 170, 40);
  const banner = await png('banner.png', 1920, 620, 40, 90, 160);
  const shot = await png('shot.png', 1280, 720, 60, 160, 90);
  await page.addInitScript(() => { try { localStorage.setItem('cookingfoil:lang', 'ko'); } catch { /* none */ } });
  fs.mkdirSync('out/web', { recursive: true });

  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto('/#tools');
    await page.locator('#tools-list .xrow', { hasText: 'Hand App' }).click();
    const card = page.locator('#xm-art .arted');
    await expect(card).toBeVisible();
    await expect(card.locator('.arted-head h4')).toHaveText('아트워크');
    if (viewport.width === 1280) {
      await choose(page, card.locator('.atile.a-icon'), icon);
      await expect(page.locator('#xm-art .atile.a-icon .reset')).toBeVisible();
      await choose(page, page.locator('#xm-art .atile.a-banner'), banner);
      await expect(page.locator('#xm-banner')).toBeVisible();
      await choose(page, page.locator('#xm-art .atile.a-add'), shot);
      await choose(page, page.locator('#xm-art .atile.a-add'), shot);
      await expect(page.locator('#xm-art .atile.a-shot')).toHaveCount(2);
      await expect(page.locator('#xm-screens img')).toHaveCount(2);
      await expect(page.locator('#xm-art .arted-label')).toHaveText('스크린샷 2/8');
    }
    await page.waitForTimeout(500);
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `out/web/art-editor-homebrew-${viewport.width}.png` });
    await page.locator('#xmodal .modal-x').click();
  }

  // The public listing carries what was uploaded.
  const listed = (await (await page.request.get('/api/homebrew?with=titles')).json()).homebrew.find((a: { name: string }) => a.name === 'Hand App');
  expect(listed.banner_url).toMatch(/\/banner\?v=/);
  expect(listed.screenshots).toHaveLength(2);
  expect(listed.icon_url).toMatch(/\/icon\?v=/);

  // Taking things back out.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/#tools');
  await page.locator('#tools-list .xrow', { hasText: 'Hand App' }).click();
  await page.locator('#xm-art .atile.a-shot').first().locator('.reset').click();
  await expect(page.locator('#xm-art .atile.a-shot')).toHaveCount(1);
  await page.locator('#xm-art .atile.a-banner .reset').click();
  await expect(page.locator('#xm-banner')).toBeHidden();
  await page.locator('#xm-art .atile.a-icon .reset').click();
  await expect(page.locator('#xm-art .atile.a-icon .reset')).toHaveCount(0);
  await page.locator('#xm-art .atile.a-shot .reset').click();
  await expect(page.locator('#xm-art .atile.a-shot')).toHaveCount(0);
  await page.locator('#xmodal .modal-x').click();

  // A patch gets the same card, and its window shows what it was given.
  await page.goto('/#patches');
  const gameHead = page.locator('#patches-list .xhead', { hasText: 'Test Game' });
  if ((await gameHead.getAttribute('aria-expanded')) !== 'true') await gameHead.click();
  await page.locator('#patches-list .xrow').first().click();
  const pcard = page.locator('#xm-art .arted');
  await expect(pcard).toBeVisible();
  await choose(page, pcard.locator('.atile.a-banner'), banner);
  await expect(page.locator('#xm-banner')).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'out/web/art-editor-patch.png' });
  await page.locator('#xm-art .atile.a-banner .reset').click();
  await expect(page.locator('#xm-banner')).toBeHidden();
});

test('the game window uses the same card', async ({ page }) => {
  await page.goto('/#all');
  await page.locator('#games .game').first().click();
  const card = page.locator('#modal-art .arted');
  await expect(card).toBeVisible();
  await expect(card.locator('.atile.a-icon')).toBeVisible();
  await expect(card.locator('.atile.a-banner')).toBeVisible();
  await expect(card.locator('.atile.a-add')).toBeVisible();
});
