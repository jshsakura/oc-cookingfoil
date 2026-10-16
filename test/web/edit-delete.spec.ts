import { test, expect, type Page } from '@playwright/test';

// The edit page's delete button: a red button at its end, a question inside the page first
// (cancel starts focused), then the kind's own endpoint; the window closes and the list is read again.
async function admin(page: Page) {
  await page.addInitScript(() => { try { localStorage.setItem('cookingfoil:lang', 'ko'); } catch { /* none */ } });
  await page.route('**/api/uploads', (route) => route.fulfill({ json: { ok: true } }));
}

const game = [
  { url: '../A%2FGame%20%5B0100000000010000%5D%5Bv0%5D.nsp', name: 'Test Game [0100000000010000][v0]', size: 8e9, kind: 'base', mtime: 1, titleId: '0100000000010000', baseTitleId: '0100000000010000' },
  { url: '../A%2FGame%20%5B0100000000010800%5D%5Bv65536%5D.nsp', name: 'Test Game [0100000000010800][v65536]', size: 5e8, kind: 'update', mtime: 1, titleId: '0100000000010800', baseTitleId: '0100000000010000' },
];

test('a game is deleted from its edit page: every file of it, after asking, and the list drops it', async ({ page }) => {
  await admin(page);
  let files = [...game];
  let shopReads = 0;
  const removed: string[] = [];
  await page.route('**/shop.json', (route) => { shopReads++; route.fulfill({ json: { files, titledb: {} } }); });
  await page.route('**/api/shop/sections', (route) => route.fulfill({ json: { sections: [{ id: 'all', title: 'All', items: [{ app_type: 'base', title_id: '0100000000010000', app_version: 0, languages: ['ko'], install_size: 9e9 }] }], genres: {} } }));
  await page.route('**/api/art/0100000000010000', (route) => route.fulfill({ json: { icon: false, banner: false, screens: [], originals: {} } }));
  await page.route('**/api/art/0100000000010000/meta', (route) => route.fulfill({ json: { name: {}, description: {}, notes: {}, original: {} } }));
  await page.route('**/admin/api/library/files/remove', (route) => { removed.push(route.request().postDataJSON().rel); route.fulfill({ json: { ok: true } }); });
  await page.goto('/');
  await page.locator('#games .game').first().click();
  await page.locator('#modal .modal-gear').click();
  const del = page.locator('#modal .edit-danger .btn.danger');
  await expect(del).toHaveText('삭제');
  await expect(del.locator('svg.bi')).toHaveCount(1);

  // Cancel keeps everything; Esc closes the question only.
  await del.click();
  await expect(page.locator('#confirm')).toHaveClass(/open/);
  await expect(page.locator('#confirm-no')).toBeFocused();
  await expect(page.locator('#confirm-text')).toContainText('2개');
  await expect(page.locator('#confirm-name')).toHaveText('Test Game');
  await page.keyboard.press('Escape');
  await expect(page.locator('#confirm')).not.toHaveClass(/open/);
  await expect(page.locator('#modal')).toHaveClass(/open/);
  expect(removed).toEqual([]);

  // Delete: both files go, the window closes, the shop is read again without the game.
  files = [];
  const before = shopReads;
  await del.click();
  await page.locator('#confirm-yes').click();
  await expect.poll(() => removed).toEqual(['A/Game [0100000000010000][v0].nsp', 'A/Game [0100000000010800][v65536].nsp']);
  await expect(page.locator('#modal')).not.toHaveClass(/open/);
  await expect.poll(() => shopReads).toBeGreaterThan(before);
  await expect(page.locator('#games .game')).toHaveCount(0);
});

const app = (extra: Record<string, unknown>) => ({
  id: 'm-aaaaaaaaaaaa', app: 'handapp', name: 'Hand App', version: '1.0', size: 1048576, kind: 'tool', source: 'manual', files: [], ...extra,
});

for (const [label, extra, endpoint, body, words] of [
  ['hand-placed', {}, '/admin/api/homebrew/manual/remove', { id: 'm-aaaaaaaaaaaa' }, '직접 넣은 앱 파일'],
  ['from a repository', { id: 'gh-aaaaaaaaaaaa', source: 'github', repo_url: 'https://github.com/example/tool' }, '/admin/api/homebrew/remove', { repo: 'example/tool' }, '저장소 연동을 끊고'],
] as const) {
  test(`a ${label} homebrew app is deleted from its edit page (${endpoint})`, async ({ page }) => {
    await admin(page);
    let list = [app(extra)];
    let sent: unknown = null;
    await page.route('**/api/homebrew?*', (route) => route.fulfill({ json: { homebrew: list } }));
    await page.route(`**${endpoint}`, (route) => { sent = route.request().postDataJSON(); list = []; route.fulfill({ json: { ok: true } }); });
    await page.route('**/api/art/homebrew/*', (route) => route.fulfill({ json: route.request().url().endsWith('/meta') ? { kind: 'tool', description: null } : { icon: null, banner: null, screenshots: [], originals: {} } }));
    await page.goto('/#tools');
    await page.locator('#tools-list .xrow', { hasText: 'Hand App' }).click();
    await page.locator('#xmodal .modal-gear').click();
    await page.locator('#xmodal .edit-danger .btn.danger').click();
    await expect(page.locator('#confirm-text')).toContainText(words);
    await expect(page.locator('#confirm-text')).toContainText('손으로 넣은 그림, 소개, 분류');
    await page.locator('#confirm-yes').click();
    await expect.poll(() => sent).toEqual(body);
    await expect(page.locator('#xmodal')).not.toHaveClass(/open/);
    await expect(page.locator('#tools-list .xrow', { hasText: 'Hand App' })).toHaveCount(0);
  });
}

test('a delete the admin session does not allow says so instead of "2fa required"', async ({ page }) => {
  await admin(page);
  await page.route('**/api/homebrew?*', (route) => route.fulfill({ json: { homebrew: [app({})] } }));
  await page.route('**/admin/api/homebrew/manual/remove', (route) => route.fulfill({ status: 401, json: { error: '2fa required' } }));
  await page.route('**/api/art/homebrew/*', (route) => route.fulfill({ json: route.request().url().endsWith('/meta') ? { kind: 'tool', description: null } : { icon: null, banner: null, screenshots: [], originals: {} } }));
  await page.goto('/#tools');
  await page.locator('#tools-list .xrow', { hasText: 'Hand App' }).click();
  await page.locator('#xmodal .modal-gear').click();
  await page.locator('#xmodal .edit-danger .btn.danger').click();
  await page.locator('#confirm-yes').click();
  await expect(page.locator('.toast-rack')).toContainText('관리자 화면에서 로그인');
  await expect(page.locator('#xmodal')).toHaveClass(/open/);
});
