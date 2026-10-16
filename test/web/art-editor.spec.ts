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

// The gear left of the X swaps the detail for the edit page.
async function editPage(page: Page, modal: string) {
  await page.locator(`${modal} .modal-gear`).click();
  await expect(page.locator(`${modal} .modal-gear`)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator(`${modal} .edit-facts form`)).toBeVisible();
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
    await editPage(page, '#xmodal');
    const card = page.locator('#xm-art .arted');
    await expect(card).toBeVisible();
    await expect(card.locator('.arted-head h4')).toHaveText('아트워크');
    if (viewport.width === 1280) {
      await choose(page, card.locator('.atile.a-icon'), icon);
      await expect(page.locator('#xm-art .atile.a-icon .reset')).toBeVisible();
      await choose(page, page.locator('#xm-art .atile.a-banner'), banner);
      await expect(page.locator('#xm-banner')).toBeVisible();
      // One upload at a time: a tile ignores a click while its picture is still on the way.
      await choose(page, page.locator('#xm-art .atile.a-add'), shot);
      await expect(page.locator('#xm-art .atile.a-shot')).toHaveCount(1);
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
  await editPage(page, '#xmodal');
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
  await editPage(page, '#xmodal');
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
  await editPage(page, '#modal');
  const card = page.locator('#modal-art .arted');
  await expect(card).toBeVisible();
  await expect(card.locator('.atile.a-icon')).toBeVisible();
  await expect(card.locator('.atile.a-banner')).toBeVisible();
  await expect(card.locator('.atile.a-add')).toBeVisible();
});

test('the edit page saves a patch, a homebrew app and a game, and the detail shows it afterwards', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('cookingfoil:lang', 'ko'); } catch { /* none */ } });
  // A patch: its Korean name and whether the game needs it.
  await page.goto('/#patches');
  const gameHead = page.locator('#patches-list .xhead', { hasText: 'Test Game' });
  if ((await gameHead.getAttribute('aria-expanded')) !== 'true') await gameHead.click();
  await page.locator('#patches-list .xrow').first().click();
  await editPage(page, '#xmodal');
  const form = page.locator('#xmodal .edit-facts form');
  await expect(page.locator('#xm-desc')).toBeHidden();
  await form.locator('[name="nameKo"]').fill('편집한 패치');
  const required = form.getByRole('switch', { name: /필수 패치/ });
  const was = await required.isChecked();
  await required.setChecked(!was);
  fs.mkdirSync('out/web', { recursive: true });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'out/web/edit-page-patch.png' });
  await form.getByRole('button', { name: '저장' }).click();
  await expect(page.locator('#toasts .toast').last()).toContainText('저장했습니다');
  await page.locator('#xmodal .modal-gear').click();
  await expect(page.locator('#xmodal .modal-gear')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#xm-title')).toHaveText('편집한 패치');
  await expect(page.locator('#xm-desc')).toBeVisible();
  const listed = (await (await page.request.get('/api/patches?lang=ko')).json()).patches as { name: string; required: boolean }[];
  const edited = listed.find((p) => p.name === '편집한 패치');
  expect(edited?.required).toBe(!was);
  await page.locator('#xmodal .modal-x').click();

  // A homebrew app: its Korean description.
  await page.goto('/#tools');
  await page.locator('#tools-list .xrow', { hasText: 'Hand App' }).click();
  await editPage(page, '#xmodal');
  await page.locator('#xmodal .edit-facts [name="descKo"]').fill('손으로 고친 설명입니다.');
  await page.locator('#xmodal .edit-facts').getByRole('button', { name: '저장' }).click();
  await expect(page.locator('#toasts .toast').last()).toContainText('저장했습니다');
  await page.locator('#xmodal .modal-gear').click();
  await expect(page.locator('#xm-desc')).toHaveText('손으로 고친 설명입니다.');
  await page.locator('#xmodal .modal-x').click();

  // A game: its Korean description, shown once the edit page is left.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#all');
  await page.locator('#games .game').first().click();
  await editPage(page, '#modal');
  await page.locator('#modal .edit-facts [name="descKo"]').fill('관리자가 쓴 게임 소개입니다.');
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'out/web/edit-page-game-390.png' });
  await page.locator('#modal .edit-facts').getByRole('button', { name: '저장' }).click();
  await expect(page.locator('#toasts .toast').last()).toContainText('저장했습니다');
  await page.locator('#modal .modal-gear').click();
  await expect(page.locator('#modal-desc')).toContainText('관리자가 쓴 게임 소개입니다.');
});
