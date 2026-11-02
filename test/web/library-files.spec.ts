import { type Page } from '@playwright/test';
import { test, expect } from './library-fixture';
import fs from 'node:fs';
import path from 'node:path';
import { signIn } from './admin-sign-in';
import { shot } from './shots';

// The 전체 목록 page's list: a tab per kind with its count, a page of 25
// at a time, and a search that stays inside the chosen kind.
const GAMES = process.env.COOK_GAMES_DIR!;
const EXTRA = `${GAMES}/zz-e2e-extras`;


test('the 전체 목록 page lists files by kind with counts, pages and a search inside the kind', async ({ page, request, libraryFile }) => {
  // 55 stray files: not game files, so the library list stays as it is.
  fs.rmSync(EXTRA, { recursive: true, force: true });
  for (let i = 0; i < 55; i++) libraryFile(`${path.basename(EXTRA)}/note-${String(i).padStart(2, '0')}.txt`, 'x'.repeat(i + 1));
  await signIn(page);
  const cookie = (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; ');
  // A rescan also drops the cached list of stray files.
  await request.post('/admin/api/library/rescan', { headers: { Cookie: cookie }, data: {} });
  await expect.poll(async () => (await (await request.get('/admin/api/library/browse?counts_only=1', { headers: { Cookie: cookie } })).json()).counts?.other, { timeout: 15000 }).toBeGreaterThanOrEqual(55);

  await page.goto('/admin/library');
  // The kinds are a filter on one list: a labelled group of toggle buttons, 전체 first and on.
  const tabs = page.locator('#lb-kinds button');
  await expect(page.locator('#lb-kinds')).toHaveAttribute('role', 'group');
  await expect(tabs).toHaveText([/전체/, /게임/, /업데이트/, /DLC/, /패치/, /세이브/, /홈브류/, /기타/]);
  await expect(page.locator('#lb-tab-all')).toHaveAttribute('aria-pressed', 'true');
  // The list opens newest first; by name the fixtures come back to the top.
  await expect(page.locator('#lb-sort')).toHaveValue('mtime');
  // One direction per sort, as on the console: no direction button.
  await expect(page.locator('#lb-order')).toHaveCount(0);
  await page.locator('#lb-sort').selectOption('name');
  await expect(page.locator('#lb-list')).toContainText('게임 데이터');
  await page.locator('#lb-tab-base').click();
  await expect(page.locator('#lb-tab-base')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#lb-tab-all')).toHaveAttribute('aria-pressed', 'false');
  // Other specs may add a game for a moment (the games folder is shared): at least the one fixture.
  await expect(page.locator('#lb-n-base')).not.toHaveText('0');
  await expect(page.locator('#lb-list')).toContainText('Test Game');
  // The check column shows a word, never a raw dictionary key.
  const checks = page.locator('#lb-list .pill');
  await expect(checks.first()).toBeVisible();
  for (const t of await checks.allInnerTexts()) expect(t).not.toMatch(/^lb\./);
  // The version is an internal number; a chip row for it would only pick among this page's rows.
  await expect(page.locator('#lb-list .grid-chips-label', { hasText: '버전' })).toHaveCount(0);
  await expect(page.locator('#lb-n-patch')).not.toHaveText('0');
  await expect(page.locator('#lb-n-other')).not.toHaveText('0');
  // Every command button in the browser carries an icon; a row's name (it opens the item) has its picture beside it.
  for (const b of await page.locator('#lib-files button:not(.lb-open)').all()) await expect(b.locator('svg')).toHaveCount(1);

  fs.mkdirSync('out/web', { recursive: true });
  await page.locator('#lb-tab-patch').click();
  await expect(page.locator('#lb-tab-patch')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#lb-list')).toContainText('게임 데이터');
  // Each patch leads with the game it is for; the game's own file is not listed here.
  await expect(page.locator('#lb-list .lb-for', { hasText: '게임 데이터' }).locator('b')).toHaveText('Test Game');
  await expect(page.locator('#lb-list')).not.toContainText('.nsp');
  await shot(page.locator('#lib-files'), { path: 'out/web/admin-library-patches.png' });

  await page.locator('#lb-tab-other').click();
  await expect(page.locator('#lb-list .ag-row', { hasText: 'note-' })).toHaveCount(25);
  await expect(page.locator('#lb-pager')).toBeVisible();
  await expect(page.locator('#lb-count')).toContainText('1에서 25번째');
  await page.getByRole('button', { name: '다음 페이지' }).click();
  await expect(page.locator('#lb-pager [aria-current=page]')).toHaveText('2');
  await expect(page.locator('#lb-list')).toContainText('note-30.txt');
  await page.getByRole('button', { name: '이전 페이지' }).click();
  await expect(page.locator('#lb-pager [aria-current=page]')).toHaveText('1');

  // Biggest first.
  await page.locator('#lb-sort').selectOption('size');
  await expect(page.locator('#lb-list .ag-row').first()).toContainText('note-54.txt');

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: 'light' });
  await shot(page.locator('#lib-files'), { path: 'out/web/library-files-1280-light.png', animations: 'disabled' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await shot(page.locator('#lib-files'), { path: 'out/web/library-files-1280-dark.png', animations: 'disabled' });

  // The search stays inside the kind: a game name finds nothing among the stray files.
  await page.locator('#lb-q').fill('Test Game');
  await page.locator('#lb-go').click();
  await expect(page.locator('#lb-list')).toContainText('이 종류에는 맞는 파일이 없습니다.');
  await expect(page.locator('#lb-n-base')).not.toHaveText('0');
  await expect(page.locator('#lb-n-other')).toHaveText('0');
  await expect(page.locator('#lb-pager')).toBeHidden();
  await page.locator('#lb-q').fill('note-07');
  await page.locator('#lb-go').click();
  await expect(page.locator('#lb-list .ag-row', { hasText: 'note-' })).toHaveCount(1);
  await expect(page.locator('#lb-n-other')).toHaveText('1');

  await page.locator('#lb-q').fill('');
  await page.locator('#lb-go').click();
  await page.locator('#lb-sort').selectOption('name');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#lb-list .ag-row', { hasText: 'note-' })).toHaveCount(25);
  await page.emulateMedia({ colorScheme: 'light' });
  await shot(page.locator('#lib-files'), { path: 'out/web/library-files-390-light.png', animations: 'disabled' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await shot(page.locator('#lib-files'), { path: 'out/web/library-files-390-dark.png', animations: 'disabled' });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth), { message: 'no sideways scroll on a phone' }).toBeLessThanOrEqual(390);
});

test('a flagged file says which it is: modified is plain, a hash mismatch is a warning, and its help opens beside it', async ({ page }) => {
  await signIn(page);
  const why = (label: string, certain: boolean) => ({ reason: 'x', certain, label, help: { title: label + ' 도움말', body: '첫 문단\n\n둘째 문단' } });
  await page.route(/\/admin\/api\/library\/browse\?/, async (route) => { const real = await (await route.fetch()).json(); await route.fulfill({ json: { ...real,
    items: [
      { name: 'Mod', kind: 'base', rel: 'A/mod.nsp', size: 1, mtime: 1, integrity: 'modified', why: why('수정됨', false) },
      { name: 'Maybe', kind: 'base', rel: 'B/maybe.nsp', size: 1, mtime: 1, integrity: 'damaged', why: why('손상 의심', false) },
      { name: 'Cut', kind: 'base', rel: 'C/cut.nsp', size: 1, mtime: 1, integrity: 'damaged', why: why('손상됨', true) },
    ],
    total: 3, page: 1, pages: 1,
  } }); });
  await page.goto('/admin/games#library/files');
  const pill = (name: string) => page.locator('#lb-list [role="row"]', { hasText: name }).locator('.lb-check .pill');
  await expect(pill('Mod')).toHaveText('수정됨');
  await expect(pill('Mod')).not.toHaveClass(/\b(off|warn)\b/);
  await expect(pill('Maybe')).toHaveText('손상 의심');
  await expect(pill('Maybe')).toHaveClass(/\bwarn\b/);
  await expect(pill('Cut')).toHaveClass(/\boff\b/);
  await page.locator('#lb-list [role="row"]', { hasText: 'Maybe' }).locator('.lv-tip').click();
  await expect(page.locator('#lv-pop')).toContainText('손상 의심 도움말');
  await expect(page.locator('#lv-pop p')).toHaveCount(2);
});

test('a row opens its item in a window: the file, the check spelled out, the game\'s other files, and its name edited in place', async ({ page }) => {
  await signIn(page);
  const base = { name: 'Detail Game', kind: 'base', rel: 'Detail/Detail Game [0100000000AA0000][v0].nsp', ext: '.nsp', size: 2048, mtime: 1, titleId: '0100000000AA0000', version: 0, integrity: 'damaged',
    why: { reason: 'hash-mismatch', certain: false, label: '손상 의심', help: { title: '내용이 원본과 다를 수 있습니다', body: '첫 문단\n\n둘째 문단' } } };
  const update = { name: 'Detail Game', kind: 'update', rel: 'Detail/Detail Game [0100000000AA0800][v65536].nsp', ext: '.nsp', size: 512, mtime: 1, titleId: '0100000000AA0800', version: 65536, integrity: 'ok' };
  const patch = { name: '한글패치', kind: 'patch', rel: '0100000000AA0000/한글패치', size: 10, mtime: 1, titleId: '0100000000AA0000', game: 'Detail Game', id: 'p1' };
  let games: string | null = null;
  await page.route(/\/admin\/api\/library\/browse\?/, async (route) => {
    const q = new URL(route.request().url()).searchParams;
    const real = await (await route.fetch()).json();
    games = q.get('game') ?? games;
    await route.fulfill({ json: { ...real, items: q.get('game') ? [base, update, patch] : [base], total: q.get('game') ? 3 : 1, page: 1, pages: 1 } });
  });
  let saved: unknown = null;
  await page.route('**/admin/api/descriptions/0100000000AA0000', async (route) => {
    if (route.request().method() === 'POST') { saved = route.request().postDataJSON(); return route.fulfill({ json: { titleId: '0100000000AA0000', own: saved } }); }
    return route.fulfill({ json: { titleId: '0100000000AA0000', own: {}, original: null, originalName: 'Detail Game' } });
  });
  await page.goto('/admin/games#library/files');
  await page.locator('#lb-list [role="row"]', { hasText: 'Detail Game' }).locator('.lb-open').click();
  const dlg = page.locator('#lb-dlg');
  await expect(dlg).toBeVisible();
  await expect(page.locator('#lb-d-name')).toHaveText('Detail Game');
  await expect(dlg).toContainText('내용이 원본과 다를 수 있습니다');
  await expect(dlg.locator('.lbd-same button')).toHaveCount(3);
  expect(games).toBe('0100000000AA0000');
  await expect(dlg.getByRole('link', { name: '폴더에서 보기' })).toHaveAttribute('href', '/admin/games?tab=folder&path=Detail');
  await shot(page, { path: 'out/web/library-item-detail.png' });
  await dlg.locator('form input').first().fill('디테일 게임');
  await page.locator('#lb-d-close').click();
  await expect(page.locator('#ask-dialog')).toContainText('저장하지 않은 내용이 있습니다.');
  await page.locator('#ask-no').click();
  await expect(dlg).toBeVisible();
  await dlg.getByRole('button', { name: '저장' }).click();
  await expect(dlg).toBeHidden();
  expect(saved).toMatchObject({ name: { ko: '디테일 게임' } });
});
