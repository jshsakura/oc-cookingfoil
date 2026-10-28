import { type Page } from '@playwright/test';
import { test, expect } from './library-fixture';
import fs from 'node:fs';
import path from 'node:path';
import { signIn } from './admin-sign-in';

const ID = '0100000000010000';
const SECOND = '0100000000470000';
const SHOTS = process.env.COOK_SHOT_DIR ?? 'out/web';
const games = process.env.COOK_GAMES_DIR!;
const secondFile = path.join(games, `Picker Second Game [${SECOND}][v0].nsp`);

async function headersOf(page: Page, cookie: string) {
  return { Cookie: cookie, Origin: new URL(page.url()).origin };
}

async function openInfo(page: Page) {
  await page.goto("/admin/games");
  await page.goto(new URL('#library/info', page.url()).toString());
  return page.locator('#gd-game');
}

// The info area's game field: Korean typed halfway, a value filled by code, Enter on an empty field,
// the list's name and status, the admin's mark, and the admin's language.
test('the game picker keeps its list through Korean typing, shows a filled value, and arms Enter only after typing', async ({ page }) => {
  const cookie = await signIn(page);
  const headers = await headersOf(page, cookie);
  expect((await page.request.post(`/admin/api/descriptions/${ID}`, { data: { name: { ko: '시험용 게임', en: '' } }, headers })).ok()).toBe(true);
  try {
    const field = await openInfo(page);
    const list = page.getByRole('listbox', { name: '게임 (이름이나 타이틀 ID 로 찾습니다)' });
    const option = list.getByRole('option', { name: new RegExp(ID) });

    // Enter on an empty field opens the list but picks nothing.
    await field.focus();
    await expect(list).toBeVisible();
    await field.press('Enter');
    await expect(page.locator('#gd-body')).toBeHidden();
    await expect(field).toHaveValue('');

    // Halfway through a syllable ("시ㅎ" on the way to 시험) still finds the game; the admin's mark shows.
    await field.pressSequentially('시ㅎ');
    await expect(option).toBeVisible();
    await expect(option).toContainText('직접 씀');
    // While the input method is still composing, an empty answer keeps the last list on screen.
    await field.dispatchEvent('compositionstart');
    await field.evaluate((input: HTMLInputElement) => { input.value = '시ㅎzzzz'; input.dispatchEvent(new Event('input')); });
    await page.waitForTimeout(500);
    await expect(option).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: '맞는 게임이 없습니다.' })).toHaveCount(0);
    // Once composing ends the answer stands, and the status says so to a screen reader.
    await field.dispatchEvent('compositionend');
    await expect(page.getByRole('status').filter({ hasText: '맞는 게임이 없습니다.' })).toHaveCount(1);
    await expect(list.getByRole('option')).toHaveCount(0);

    // A value filled by code shows that game as the current value, and Enter does not pick it again.
    await field.evaluate((input: HTMLInputElement, id) => { input.value = `Test Game [${id}]`; input.blur(); }, ID);
    await field.focus();
    await expect(option).toContainText('지금 값');
    await expect(field).not.toHaveAttribute('aria-activedescendant');
    // One "]" deleted: the title ID still finds the game.
    await field.press('End');
    await field.press('Backspace');
    await expect(option).toBeVisible();
    // Typed, not filled: the first game is armed for Enter now.
    await expect(field).toHaveAttribute('aria-activedescendant', /.+/);
    await field.press('Enter');
    await expect(field).toHaveValue(/\[0100000000010000\]$/);
    await expect(page.locator('#gd-body')).toBeVisible();
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/game-picker-info.png` });

    // In English the field's label, placeholder and the list's messages are all English.
    await page.locator('#lang-btn').click();
    await page.locator('[data-admin-lang="en"]').click();
    await expect(field).toHaveAttribute('placeholder', 'Search by game name or part of the title ID');
    await field.fill('');
    await field.pressSequentially('zzzzqq');
    await expect(page.getByRole('listbox', { name: 'Game (find it by name or title ID)' })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'No game matches.' })).toHaveCount(1);
    await page.screenshot({ path: `${SHOTS}/game-picker-en.png` });
  } finally {
    await page.evaluate(() => { try { localStorage.removeItem('cookingfoil:lang'); } catch { /* none */ } });
    await page.request.post(`/admin/api/descriptions/${ID}/reset`, { data: { field: 'name' }, headers });
  }
});

// The home picks row: a list of every game with a tick box, filtered by its own search box.
test('a home picks row marks games from its list, one found by search, unmarks one, and saves', async ({ page, libraryFile, undo }) => {
  const cookie = await signIn(page);
  const headers = await headersOf(page, cookie);
  libraryFile(path.basename(secondFile));
  undo(() => page.request.put('/admin/api/featured', { data: { collections: [] }, headers }));
  await page.request.post('/admin/api/library/rescan', { headers, data: {} });
  await expect.poll(async () => (await (await page.request.get(`/admin/api/games/search?q=${SECOND}`, { headers })).json()).total, { timeout: 15_000 }).toBe(1);

  await page.goto("/admin/games");
  await page.goto('/admin/featured');
  await page.getByRole('button', { name: '추천 줄 추가', exact: true }).click();
  await page.getByLabel('줄 제목', { exact: true }).fill('고른 게임');
  const list = page.getByRole('list', { name: '게임 목록' });
  await expect(list.getByRole('checkbox')).toHaveCount(2);
  await list.getByRole('checkbox', { name: new RegExp(ID) }).check();

  // The search box filters the same list; the second game is ticked from the filtered list.
  await page.getByRole('searchbox', { name: '게임 목록에서 찾기' }).pressSequentially('picker');
  await expect(list.getByRole('checkbox')).toHaveCount(1);
  await list.getByRole('checkbox', { name: new RegExp(SECOND) }).check();
  const row = page.locator('#f-list .fgames li');
  await expect(row).toHaveCount(2);

  // "Picked only" lists what is in the row; unticking the first takes it out.
  await page.getByRole('searchbox', { name: '게임 목록에서 찾기' }).fill('');
  await page.getByRole('checkbox', { name: '추천한 것만' }).check();
  await expect(list.getByRole('checkbox', { checked: true })).toHaveCount(2);
  await list.getByRole('checkbox', { name: new RegExp(ID) }).uncheck();
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Picker Second Game');
  await page.screenshot({ path: `${SHOTS}/featured-list.png`, fullPage: true });

  await page.getByRole('button', { name: /^저장/ }).click();
  await expect(page.locator('#toast')).toContainText('추천을 저장했습니다');
  await expect.poll(async () => (await (await page.request.get('/api/library/sections')).json()).featured?.[0]?.title_ids)
    .toEqual([SECOND]);
  await page.reload();
  await page.goto("/admin/games");
  await page.goto('/admin/featured');
  await expect(page.locator('#f-list .fgames li')).toContainText('Picker Second Game');

  // A game's own page puts it in a row too.
  const field = await openInfo(page);
  await field.fill(`Test Game [${ID}]`);
  await field.dispatchEvent('change');
  await expect(page.locator('#gd-body')).toBeVisible();
  await page.locator('#gd-feat-row').selectOption({ label: '고른 게임' });
  await page.getByRole('button', { name: '추천에 넣기' }).click();
  await expect(page.locator('#toast')).toContainText('추천에 넣었습니다');
  await expect.poll(async () => (await (await page.request.get('/api/library/sections')).json()).featured?.[0]?.title_ids)
    .toEqual([SECOND, ID]);
});
