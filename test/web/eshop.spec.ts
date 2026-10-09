import { test, expect } from '@playwright/test';
import { catalogFixture } from './fixtures';
import fs from 'node:fs';
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cookingfoil:eshop-lang', JSON.stringify('ko')));
  await catalogFixture(page);
});
test('home renders grouped games, honest metadata rows and a working sidebar', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('.hero h1')).toHaveText('Darkest Dungeon II');
  await expect(page.getByRole('heading', { name: '최근 추가' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '한국어 지원' })).toBeVisible();
  await page.locator('[data-view="library"]').click();
  await expect(page.locator('#games .game')).toHaveCount(13);
  await page.locator('#search').fill('마리오');
  await expect(page.locator('#games .game')).toHaveCount(1);
  await page.locator('#search').fill('nothing matches');
  await expect(page.locator('#games')).toContainText('조건에 맞는 게임이 없습니다.');
  expect(errors).toEqual([]);
});
test('detail is a full screen, selection changes totals and browser downloads are queued', async ({ page }) => {
  await page.goto('/#library');
  await page.getByRole('button', { name: 'Darkest Dungeon II', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('#detail-title')).toHaveText('Darkest Dungeon II');
  await expect(page.locator('#detail-files input')).toHaveCount(4);
  await expect(page.locator('#detail-files input').first()).toBeDisabled();
  await page.locator('#detail-files label').filter({ hasText: 'Inhuman Bondage' }).locator('input').uncheck();
  await expect(page.locator('#detail-total')).toHaveText('6.2 GB');
  await page.locator('#detail-add').click();
  await expect(page.locator('#detail')).toBeHidden();
  await expect(page.locator('#download-list .download-row')).toHaveCount(3);
  await expect(page.locator('#downloads-count')).toHaveText('3');
  await page.reload();
  await expect(page.locator('#download-list .download-row')).toHaveCount(3);
  await page.locator('#download-list button').filter({ hasText: '제거' }).first().click();
  await expect(page.locator('#download-list .download-row')).toHaveCount(2);
});
test('Escape closes detail and restores keyboard focus; language controls update screens', async ({ page }) => {
  await page.goto('/#library');
  const card = page.getByRole('button', { name: 'Darkest Dungeon II', exact: true });
  await card.focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#detail-back')).toBeFocused();
  await page.keyboard.press('Escape'); await expect(card).toBeFocused();
  await page.locator('[data-view="settings"]').click();
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.locator('[data-view="library"]').click();
  await expect(page.getByRole('heading', { name: 'All games' })).toBeVisible();
});
test('older servers omit recent and Korean rows without claiming language support', async ({ page }) => {
  await catalogFixture(page, false); await page.goto('/');
  await expect(page.locator('.hero')).toBeVisible();
  await expect(page.getByRole('heading', { name: '최근 추가' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '한국어 지원' })).toHaveCount(0);
  await page.locator('[data-view="library"]').click();
  await page.locator('[data-filter="ko"]').click();
  await expect(page.locator('#games .game')).toHaveCount(0);
});
test('mobile navigation and full detail fit a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width:390, height:844 }); await page.goto('/');
  await expect(page.locator('.hero')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.locator('[data-view="library"]').click();
  await page.getByRole('button', { name: 'Darkest Dungeon II', exact: true }).click();
  await expect(page.locator('#detail-add')).toBeVisible();
  expect(await page.locator('#detail').evaluate((node) => node.scrollWidth)).toBeLessThanOrEqual(390);
});
test('screenshots expand with keyboard navigation and trailers stop on detail close', async ({ page }) => {
  fs.mkdirSync('out/web', { recursive:true });
  await page.route('**/api/title/*', (route) => route.fulfill({ json: {
    description: '미리보기 자료를 확인합니다.',
    screenshots: ['/fixture-icons/0100E5E01C098000.jpg', '/fixture-icons/01002FC00412C000.jpg'],
    videos: [{ type:'youtube', id:'abcdefghijk', title:'Trailer' }],
  } }));
  await page.route('https://www.youtube-nocookie.com/**', (route) => route.fulfill({ contentType:'text/html', body:'<html><body>Isolated embed fixture</body></html>' }));
  await page.goto('/#library');
  await page.getByRole('button', { name:'Darkest Dungeon II', exact:true }).click();
  const thumbnail = page.locator('#screenshots button').first();
  await thumbnail.click();
  await expect(page.locator('.media-viewer')).toBeVisible();
  await expect(page.locator('.media-heading strong')).toHaveText('1 / 2');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.media-heading strong')).toHaveText('2 / 2');
  await page.screenshot({ path:'out/web/gallery.png' });
  await page.keyboard.press('Escape');
  await expect(page.locator('.media-viewer')).toHaveCount(0);
  await expect(page.locator('#detail')).toBeVisible();
  await expect(thumbnail).toBeFocused();
  await page.getByRole('button', { name:'▶  Trailer' }).click();
  await expect(page.locator('.trailer-player')).toHaveAttribute('src', /youtube-nocookie.com\/embed\/abcdefghijk/);
  await page.screenshot({ path:'out/web/trailer-embed-fixture.png' });
  await page.locator('#detail-back').click();
  await expect(page.locator('.trailer-player')).toHaveCount(0);
});
test('desktop and mobile screenshots are captured from the actual UI', async ({ page }) => {
  fs.mkdirSync('out/web', { recursive:true });
  await page.setViewportSize({ width:1280, height:720 });
  for (const screen of ['home', 'library', 'downloads', 'settings']) {
    await page.goto('/#' + screen); await expect(page.locator('#' + screen + '-screen')).toBeVisible();
    await expect(page.locator('#connection-dot')).toHaveClass('dot ready');
    await page.evaluate(async () => { await document.fonts.ready; });
    await page.screenshot({ path:'out/web/' + screen + '.png' });
  }
  await page.goto('/#library'); await page.getByRole('button', { name:'Darkest Dungeon II', exact:true }).click();
  await expect(page.locator('#detail-description')).not.toHaveText('게임을 불러오고 있습니다.');
  await page.screenshot({ path:'out/web/detail.png' });
  await page.setViewportSize({ width:390, height:844 });
  await page.screenshot({ path:'out/web/detail-mobile.png' });
  await page.locator('#detail-back').click(); await page.locator('[data-view="home"]').click();
  await page.screenshot({ path:'out/web/home-mobile.png' });
});
test('upload staging, explicit apply and delete keep their real server behavior', async ({ page, request }) => {
  await page.unroute('**/api/uploads');
  await page.goto('/#downloads');
  const name = `UI-upload-${Date.now()}.nro`;
  await page.locator('#file-input').setInputFiles({ name, mimeType:'application/octet-stream', buffer:Buffer.from('CookingFoil UI integration fixture') });
  const row = page.locator('.upload-row').filter({ hasText:name });
  await expect(row).toBeVisible();
  const before = await (await request.get('/api/uploads')).json();
  expect(before.uploads.some((u: {name:string}) => u.name === name)).toBe(true);
  await row.getByRole('button', { name:'목록에 반영', exact:true }).click();
  await expect(row).toHaveCount(0);
  expect(fs.existsSync('/tmp/cookingfoil-web-test-games/' + name)).toBe(true);
  fs.unlinkSync('/tmp/cookingfoil-web-test-games/' + name);
  const second = name.replace('UI-upload-', 'UI-delete-');
  await page.locator('#file-input').setInputFiles({ name:second, mimeType:'application/octet-stream', buffer:Buffer.from('fixture') });
  const pending = page.locator('.upload-row').filter({ hasText:second });
  await expect(pending).toBeVisible();
  await pending.getByRole('button', { name:'삭제', exact:true }).click();
  await expect(pending).toHaveCount(0);
  const after = await (await request.get('/api/uploads')).json();
  expect(after.uploads.some((u: {name:string}) => u.name === second)).toBe(false);
});
