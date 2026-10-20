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
  // Every new picture goes through the crop view; the whole-fit box is applied as it comes.
  await page.locator('.crop .crop-actions .btn:not(.ghost)').click();
}

// The gear left of the X swaps the detail for the edit page.
async function editPage(page: Page, modal: string) {
  // The window eases to its new height and then fits what it shows (no fixed, half empty window).
  await page.locator(`${modal} .modal-gear`).click();
  await page.waitForTimeout(450);
  const box = (await page.locator(`${modal} .modal`).boundingBox())!;
  const fits = await page.locator(`${modal} .modal`).evaluate((m) => m.style.height === '');
  expect(fits).toBe(true);
  expect(box.height).toBeLessThanOrEqual(page.viewportSize()!.height);
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
  // One name box: the Korean page edits the Korean name.
  await form.locator('[name="names"]').fill('편집한 패치');
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
  const hbDesc = page.locator('#xmodal .edit-facts [name="desc"]');
  await hbDesc.fill('손으로 고친 설명입니다.');
  // The switch shows the English box; what was typed in Korean waits there until saved.
  const langs = page.locator('#xmodal .edit-facts .ef-langs');
  await expect(langs.getByRole('button', { name: '한국어' })).toHaveAttribute('aria-pressed', 'true');
  await langs.getByRole('button', { name: 'English' }).click();
  await expect(hbDesc).toHaveValue('');
  await hbDesc.fill('Fixed by hand.');
  await langs.getByRole('button', { name: '한국어' }).click();
  await expect(hbDesc).toHaveValue('손으로 고친 설명입니다.');
  await page.locator('#xmodal .edit-facts').getByRole('button', { name: '저장' }).click();
  await expect(page.locator('#toasts .toast').last()).toContainText('저장했습니다');
  await page.locator('#xmodal .modal-gear').click();
  await expect(page.locator('#xm-desc')).toHaveText('손으로 고친 설명입니다.');
  // Both languages went in the one save.
  const hbId = (await (await page.request.get('/api/homebrew?with=titles')).json()).homebrew.find((a: { name: string }) => a.name === 'Hand App').id;
  expect((await (await page.request.get(`/api/art/homebrew/${hbId}/meta`)).json()).description).toEqual({ ko: '손으로 고친 설명입니다.', en: 'Fixed by hand.' });
  await page.locator('#xmodal .modal-x').click();

  // A game: its Korean description, shown once the edit page is left.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#all');
  await page.locator('#games .game').first().click();
  await editPage(page, '#modal');
  await page.locator('#modal .edit-facts [name="desc"]').fill('관리자가 쓴 게임 소개입니다.');
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'out/web/edit-page-game-390.png' });
  await page.locator('#modal .edit-facts').getByRole('button', { name: '저장' }).click();
  await expect(page.locator('#toasts .toast').last()).toContainText('저장했습니다');
  await page.locator('#modal .modal-gear').click();
  await expect(page.locator('#modal-desc')).toContainText('관리자가 쓴 게임 소개입니다.');
});

test('a slot finds pictures from the sources, and one click cuts and saves the picked one', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('cookingfoil:lang', 'ko'); } catch { /* none */ } });
  const picture = await sharp({ create: { width: 1920, height: 1080, channels: 3, background: { r: 200, g: 60, b: 90 } } }).jpeg().toBuffer();
  const asked: URLSearchParams[] = [];
  await page.route('**/api/art/search?*', (route) => {
    const q = new URL(route.request().url()).searchParams;
    asked.push(q);
    const slot = q.get('slot');
    return route.fulfill({ json: {
      q: q.get('q') || 'Test Game', errors: [], missing: ['igdb'],
      items: [1, 2, 3].map((n) => ({ source: n === 1 ? 'eshop' : 'sgdb', game: { id: n, name: 'Test Game' }, label: n === 1 ? 'ko' : '',
        thumb: `/api/art/remote?url=pic${slot}${n}`, url: `https://cdn2.steamgriddb.com/${slot}/${n}.jpg` })),
    } });
  });
  let fetched = '';
  await page.route('**/api/art/remote?*', (route) => {
    fetched = new URL(route.request().url()).searchParams.get('url') || '';
    return route.fulfill({ body: picture, contentType: 'image/jpeg' });
  });

  // A game: the finder asks with the game's id, offers the pictures and saves the picked one.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/#all');
  await page.locator('#games .game').first().click();
  await editPage(page, '#modal');
  const card = page.locator('#modal-art .arted');
  await card.locator('.atile.a-banner .find').click();
  const finder = card.locator('.arted-find');
  await expect(finder.locator('h4')).toHaveText('배너 찾기');
  await expect(finder.locator('.pick')).toHaveCount(3);
  await expect(finder.locator('.state')).toContainText('IGDB 키가 없어');
  expect(asked[0].get('slot')).toBe('banner');
  expect(asked[0].get('base')).toMatch(/^[0-9A-F]{16}$/);
  await expect(finder.locator('input')).toHaveValue('Test Game');
  await finder.locator('.pick').nth(1).click();
  await page.locator('#modal-art .crop').getByRole('button', { name: '적용' }).click();
  expect(fetched).toBe('https://cdn2.steamgriddb.com/banner/2.jpg');
  await expect(card.locator('.atile.a-banner .reset')).toBeVisible();
  await expect(finder).toHaveCount(0);

  // A new name searches again; closing brings the card back as it was.
  await card.locator('.atile.a-add .find').click();
  await card.locator('.arted-find input').fill('Other Name');
  await card.locator('.arted-find .go').click();
  await expect.poll(() => asked.at(-1)?.get('q')).toBe('Other Name');
  expect(asked.at(-1)?.get('slot')).toBe('screenshot');
  await page.screenshot({ path: 'out/web/art-finder.png' });
  await card.locator('.arted-find .close').click();
  await expect(card.locator('.atile.a-icon')).toBeVisible();
  await card.locator('.atile.a-banner .reset').click();
  await expect(card.locator('.atile.a-banner .reset')).toHaveCount(0);
  await page.locator('#modal .modal-x').click();

  // A homebrew app searches by its own name, without a title id.
  await page.goto('/#tools');
  await page.locator('#tools-list .xrow', { hasText: 'Hand App' }).click();
  await editPage(page, '#xmodal');
  await page.locator('#xm-art .atile.a-icon .find').click();
  await expect(page.locator('#xm-art .arted-find .pick')).toHaveCount(3);
  expect(asked.at(-1)?.get('q')).toBe('Hand App');
  expect(asked.at(-1)?.has('base')).toBe(false);
});
