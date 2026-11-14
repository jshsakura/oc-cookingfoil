import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { signIn } from './admin-sign-in';

// The file browser in a phone's hand: nothing here needs a hover, a double click or a right click.
const games = process.env.COOK_GAMES_DIR!;
const base = path.join(games, 'fb-phone');
const put = (rel: string, body = 'x') => {
  fs.mkdirSync(path.dirname(path.join(base, rel)), { recursive: true });
  fs.writeFileSync(path.join(base, rel), body);
};
const has = (rel: string) => fs.existsSync(path.join(base, rel));
const row = (page: import('@playwright/test').Page, name: string) => page.locator('#fb-rows tr', { has: page.getByText(name, { exact: true }) });
const LONG = 'A Game With A Rather Long Name Indeed.nsp';

test.beforeEach(async ({ page }) => {
  fs.rmSync(base, { recursive: true, force: true });
  put('Alpha/one.nsp', '1');
  put('Beta/keep.txt', 'hello');
  put('loose.nsp', '333');
  put(LONG, '4444');
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await page.goto('/admin/games?tab=folder&path=fb-phone');
  await expect(row(page, 'Alpha')).toBeVisible();
});
test.afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

test('a tap opens a folder, previews what can be previewed, and only picks a game file', async ({ page }) => {
  let downloads = 0;
  page.on('download', () => { downloads++; });
  await row(page, 'Alpha').click({ position: { x: 120, y: 10 } });
  await expect(row(page, 'one.nsp')).toBeVisible();
  await page.locator('#fb-upb').click();
  await row(page, 'Beta').click({ position: { x: 120, y: 10 } });
  await row(page, 'keep.txt').click({ position: { x: 120, y: 10 } });
  await expect(page.locator('#fb-view')).toBeVisible();
  await page.locator('#fb-v-x').click();
  await page.locator('#fb-upb').click();
  await row(page, 'loose.nsp').dblclick({ position: { x: 120, y: 10 } });
  await row(page, 'loose.nsp').click({ position: { x: 120, y: 10 } });
  await expect(row(page, 'loose.nsp')).toHaveAttribute('aria-selected', 'true');
  expect(downloads).toBe(0);
});

test('with a pick held a tap adds or takes away instead of opening', async ({ page }) => {
  await row(page, 'loose.nsp').click({ position: { x: 120, y: 10 } });
  await row(page, 'Alpha').click({ position: { x: 120, y: 10 } });
  await expect(row(page, 'Alpha')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#fb-info')).toHaveText('2개를 골랐습니다');
  await row(page, 'Alpha').click({ position: { x: 120, y: 10 } });
  await expect(row(page, 'Alpha')).toHaveAttribute('aria-selected', 'false');
});

test('a pick shows what it allows in words at the bottom, and 파일 메뉴 holds the rest', async ({ page }) => {
  await row(page, 'Alpha').locator('input[type=checkbox]').check();
  const bar = page.locator('#fb-pick-acts');
  await expect(bar.getByRole('button')).toHaveText(['zip으로 내려받기', '이름 바꾸기', '이동', '휴지통으로', '파일 메뉴']);
  const box = (await bar.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(844);
  for (const b of await bar.getByRole('button').all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.locator('#fb-clear').click();
  await expect(bar.getByRole('button')).toHaveText(['올리기', '파일 메뉴']);
  // With nothing picked the bar is icons only: the names are the buttons' accessible names, not words on the screen.
  await expect(bar.getByRole('button', { name: '올리기', exact: true })).toBeVisible();
  for (const label of await bar.locator('button span').all()) await expect(label).toBeHidden();

  await row(page, 'loose.nsp').click({ position: { x: 120, y: 10 } });
  await expect(bar.getByRole('button')).toHaveText(['내려받기', '이름 바꾸기', '이동', '휴지통으로', '파일 메뉴']);
  await bar.getByRole('button', { name: '파일 메뉴' }).click();
  const menu = page.locator('#fb-menu');
  await expect(menu.getByRole('menuitem', { name: '파일 압축' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: '파일 검사' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: '속성' })).toBeVisible();
  const sheet = (await menu.boundingBox())!;
  expect(sheet.x).toBe(0);
  expect(sheet.width).toBe(390);
  expect(sheet.y + sheet.height).toBeCloseTo(844, 0);
});

test('the bar above the list keeps to what works here', async ({ page }) => {
  for (const id of ['fb-t-tree', 'fb-t-side', 'fb-back', 'fb-fwd', 'fb-cut-btn', 'fb-copy-btn', 'fb-rename-btn', 'fb-move-btn', 'fb-zip-btn', 'fb-share-btn', 'fb-trash-btn', 'fb-paste-btn', 'fb-undo-btn']) {
    await expect(page.locator('#' + id), id).toBeHidden();
  }
  await expect(page.locator('#fb-mkdir')).toBeHidden();
  await expect(page.locator('#fb-tidy-btn')).toBeHidden();
  const above = await page.evaluate(() => document.getElementById('fb-main')!.getBoundingClientRect().top - document.getElementById('fb')!.getBoundingClientRect().top);
  expect(above).toBeLessThan(170);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('tiles show their check box untouched, and it picks without opening', async ({ page }) => {
  await page.locator('#fb-v-grid').click();
  const cb = row(page, 'Alpha').locator('input[type=checkbox]');
  await expect(cb).toBeVisible();
  expect(await cb.evaluate((n) => getComputedStyle(n.closest('td')!).opacity)).toBe('1');
  await cb.check();
  await expect(row(page, 'Alpha')).toHaveAttribute('aria-selected', 'true');
  await expect(row(page, 'loose.nsp')).toBeVisible();
  await page.locator('#fb-clear').click();
  await page.locator('#fb-v-list').click();
});

test('a cut lets go of the pick, so a tap walks to the folder and paste shows there', async ({ page }) => {
  await row(page, 'loose.nsp').click({ position: { x: 120, y: 10 } });
  await page.getByRole('button', { name: '파일 메뉴' }).click();
  await page.locator('#fb-menu').getByRole('menuitem', { name: '잘라내기' }).click();
  await expect(page.locator('#fb-info')).not.toHaveText(/골랐습니다/);
  await row(page, 'Alpha').click({ position: { x: 120, y: 10 } });
  await expect(row(page, 'one.nsp')).toBeVisible();
  await page.locator('#fb-pick-acts').getByRole('button', { name: '붙여넣기' }).click();
  await expect(row(page, 'loose.nsp')).toBeVisible();
  expect(has('Alpha/loose.nsp')).toBe(true);
});

test('walking away drops the bar at once, before the next folder has loaded', async ({ page }) => {
  await row(page, 'loose.nsp').click({ position: { x: 120, y: 10 } });
  await expect(page.locator('#fb-pick-acts').getByRole('button')).toHaveCount(5);
  await page.route('**/admin/api/files**', async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  await page.locator('#fb-upb').click();
  await expect(page.locator('#fb-pick-acts').getByRole('button')).toHaveCount(2, { timeout: 500 });
  await page.unroute('**/admin/api/files**');
});

test('a details pane left on from a wide screen does not take the row buttons at tablet width', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('fb.side', '1'));
  await page.setViewportSize({ width: 820, height: 900 });
  await page.reload();
  await expect(row(page, 'Alpha')).toBeVisible();
  await expect(page.locator('#fb')).toHaveClass(/side-on/);
  await expect(row(page, 'Alpha').locator('.c-act')).toBeVisible();
});

test('turning the phone drops the row dragging with the desktop layout', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.reload();
  await expect(row(page, 'Alpha')).toHaveAttribute('draggable', 'true');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(row(page, 'Alpha')).toHaveAttribute('draggable', 'false');
});

test('a long name reads across the row, with no row buttons beside it', async ({ page }) => {
  const name = row(page, LONG).locator('.fb-name > span').first();
  expect((await name.boundingBox())!.width).toBeGreaterThan(180);
  await expect(row(page, LONG).locator('.c-act')).toBeHidden();
});

test('the header says which page this is, not only 파일', async ({ page }) => {
  await expect(page.locator('#adm-crumb .adm-crumb-g').filter({ hasText: '게임' })).toBeVisible();
  await expect(page.locator('#adm-crumb .adm-crumb-i')).toHaveText('파일');
});

test('a long notice reads across the screen, with its undo inside it', async ({ page }) => {
  await page.evaluate(() => (window as any).fbToastUndo('2개를 옮겼습니다. 다른 게임이 들어 있는 폴더입니다. 게임이 섞이지 않았는지 확인해 주십시오.'));
  const box = await page.locator('#toast').boundingBox();
  expect(box!.width).toBeGreaterThan(300);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await expect(page.locator('#toast .toast-act')).toBeVisible();
});

test('a finished upload offers only its close button, inside the screen', async ({ page }) => {
  await page.locator('#fb-file').setInputFiles([{ name: 'small.nsp', mimeType: 'application/octet-stream', buffer: Buffer.from('bytes') }]);
  await expect(row(page, 'small.nsp')).toBeVisible();
  await expect(page.locator('#fb-up-stop')).toBeHidden();
  const close = await page.locator('#fb-up-close').boundingBox();
  expect(close!.x + close!.width).toBeLessThanOrEqual(390);
});

test('properties of one game file say which game and version it is, as the details pane does', async ({ page }) => {
  const name = 'Hollow Game [0100000000010002][v65536].nsp';
  put(name, '55');
  await page.route('**/admin/api/files/list?*', async (route) => {
    const res = await route.fetch();
    const json = await res.json();
    for (const f of json.items) if (f.name === name) Object.assign(f, { titleId: '0100000000010000', kind: 'update', version: 65536, check: 'damaged', why: { label: '손상됨', certain: true, help: { title: '파일이 잘렸습니다', body: '받다가 끊긴 파일입니다.' } } });
    await route.fulfill({ response: res, json });
  });
  await page.locator('#fb-refresh').click();
  await row(page, name).click({ position: { x: 120, y: 10 } });
  await page.locator('#fb-pick-acts').getByRole('button', { name: '파일 메뉴' }).click();
  await page.locator('#fb-menu').getByRole('menuitem', { name: '속성' }).click();
  const dlg = page.locator('#fb-props');
  await expect(dlg).toBeVisible();
  await expect(dlg.locator('#fb-p-list')).toContainText('0100000000010000');
  await expect(dlg.locator('#fb-p-list')).toContainText('v65536');
  await expect(dlg.locator('#fb-p-list')).toContainText('위치');
  await expect(dlg.locator('.fb-s-head h4')).toHaveText(name);
  await expect(dlg.locator('.fb-s-badges')).toContainText('업데이트 v65536');
  await expect(dlg.locator('.fb-s-why')).toContainText('파일이 잘렸습니다');
  const art = await dlg.locator('.fb-s-head > :first-child').boundingBox();
  expect(art!.width).toBeLessThanOrEqual(96);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('a search that finds nothing here looks in the folders below, says so, and walks to a find', async ({ page }) => {
  await page.locator('#fb-q').fill('one.nsp');
  await expect(row(page, 'one.nsp')).toBeVisible();
  await expect(page.locator('#fb-deep')).toBeChecked();
  await expect(page.locator('#toast')).toContainText('하위 폴더까지');
  await page.locator('#fb-q').fill('');
  await expect(row(page, 'Alpha')).toBeVisible();
  await expect(page.locator('#fb-deep')).not.toBeChecked();

  await page.locator('#fb-q').fill('nowhere-at-all');
  await expect(page.locator('#fb-empty')).toHaveText('찾는 이름이 이 폴더와 하위 폴더에 없습니다.');

  await page.locator('#fb-q').fill('one.nsp');
  await row(page, 'one.nsp').locator('.fb-at').click();
  await expect(page).toHaveURL(/path=fb-phone%2FAlpha/);
  await expect(page.locator('#fb-q')).toHaveValue('');
  await expect(row(page, 'one.nsp')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#fb-info')).toHaveText('1개를 골랐습니다');
});

test('a search turned back to this folder by hand stays there', async ({ page }) => {
  await page.locator('#fb-q').fill('one.nsp');
  await expect(page.locator('#fb-deep')).toBeChecked();
  await page.locator('#fb-deep').uncheck();
  await expect(page.locator('#fb-empty')).toHaveText('찾는 이름이 이 폴더에 없습니다');
  await expect(page.locator('#fb-deep')).not.toBeChecked();
});

test('with nothing picked the bottom edge offers upload and 파일 메뉴, which holds the rest', async ({ page }) => {
  const bar = page.locator('#fb-pick-acts');
  await expect(bar.getByRole('button')).toHaveText(['올리기', '파일 메뉴']);
  for (const b of await bar.getByRole('button').all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expect(page.locator('#fb-foot .fb-sel-act')).toBeHidden();
  await bar.getByRole('button', { name: '파일 메뉴' }).click();
  const menu = page.locator('#fb-menu');
  for (const name of ['새 폴더', '올리기', '폴더 올리기', '정리', '다시 스캔', '속성']) await expect(menu.getByRole('menuitem', { name, exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  const first = await page.locator('#fb-rows tr').first().boundingBox();
  // The library's six tabs take two rows on a phone so none hides past the edge, and the list starts under them.
  expect(first!.y).toBeLessThan(350);
  const foot = (await page.locator('#fb-foot').boundingBox())!;
  expect(foot.height).toBeLessThan(72);
  expect(foot.y + foot.height).toBeCloseTo(844, 0);
  expect(foot.x).toBe(0);
  expect(foot.width).toBe(390);
});

test('모두 선택 beside the count picks the whole list and lets it all go again', async ({ page }) => {
  await row(page, 'loose.nsp').click({ position: { x: 120, y: 10 } });
  const all = page.locator('#fb-pick-all');
  await expect(all).toHaveText('모두 선택');
  await all.click();
  await expect(page.locator('#fb-info')).toHaveText('4개를 골랐습니다');
  await all.click();
  await expect(page.locator('#fb-info')).not.toHaveText(/골랐습니다/);
  await expect(page.locator('#fb-pick-acts').getByRole('button')).toHaveText(['올리기', '파일 메뉴']);
  await row(page, 'loose.nsp').click({ position: { x: 120, y: 10 } });
  await page.locator('#fb-pick-acts').getByRole('button', { name: '파일 메뉴' }).click();
  await expect(page.locator('#fb-menu').getByRole('menuitem', { name: '이 페이지를 전부 고릅니다' })).toHaveCount(0);
});

test('a cut speaks in taps, shows its count, survives leaving the page and can be called off', async ({ page }) => {
  const bar = page.locator('#fb-pick-acts');
  await row(page, 'loose.nsp').click({ position: { x: 120, y: 10 } });
  await bar.getByRole('button', { name: '파일 메뉴' }).click();
  await page.locator('#fb-menu').getByRole('menuitem', { name: '잘라내기' }).click();
  await expect(page.locator('#toast')).toContainText('붙여넣기를 누릅니다');
  await expect(page.locator('#toast')).not.toContainText('Ctrl');
  await expect(bar.getByRole('button', { name: '붙여넣기 1', exact: true }).locator('b')).toHaveText('1');
  await expect(bar.getByRole('button')).toHaveCount(2);
  await page.reload();
  await expect(row(page, 'loose.nsp')).toHaveClass(/fb-cut/);
  await expect(bar.getByRole('button', { name: '붙여넣기 1', exact: true }).locator('b')).toHaveText('1');
  await expect(bar.getByRole('button')).toHaveCount(2);
  await bar.getByRole('button', { name: '파일 메뉴' }).click();
  await page.locator('#fb-menu').getByRole('menuitem', { name: '붙여넣기 취소' }).click();
  await expect(bar.getByRole('button')).toHaveText(['올리기', '파일 메뉴']);
  await expect(row(page, 'loose.nsp')).not.toHaveClass(/fb-cut/);
  await page.reload();
  await expect(bar.getByRole('button')).toHaveText(['올리기', '파일 메뉴']);
  expect(has('loose.nsp')).toBe(true);
});

test('the move window offers the way up from a folder with nothing below it', async ({ page }) => {
  await row(page, 'Alpha').click({ position: { x: 120, y: 10 } });
  await row(page, 'one.nsp').click({ position: { x: 120, y: 10 } });
  await page.locator('#fb-pick-acts').getByRole('button', { name: '이동' }).click();
  const up = page.locator('#fb-m-list').getByRole('button', { name: '상위 폴더' });
  await up.click();
  await expect(page.locator('#fb-m-list').getByRole('button', { name: 'Beta' })).toBeVisible();
  await up.click();
  await expect(page.locator('#fb-m-list').getByRole('button', { name: 'fb-phone' })).toBeVisible();
  await expect(up).toHaveCount(0);
});

test('a rename selects the name, leaving a game id, version and extension alone', async ({ page }) => {
  const name = 'Hollow Game [0100000000010002][v0].nsp';
  put(name, '5');
  await page.locator('#fb-refresh').click();
  await row(page, name).click({ position: { x: 120, y: 10 } });
  await page.locator('#fb-pick-acts').getByRole('button', { name: '이름 바꾸기' }).click();
  await page.keyboard.type('Knight');
  await expect(page.locator('#ask-input')).toHaveValue('Knight [0100000000010002][v0].nsp');
  await page.locator('#ask-no').click();
  await row(page, name).click({ position: { x: 120, y: 10 } });
  await row(page, 'loose.nsp').click({ position: { x: 120, y: 10 } });
  await page.locator('#fb-pick-acts').getByRole('button', { name: '이름 바꾸기' }).click();
  await page.keyboard.type('tight');
  await expect(page.locator('#ask-input')).toHaveValue('tight.nsp');
  await page.locator('#ask-no').click();
});

test('the column heads stay on screen down a long list, and everything around the list takes a thumb', async ({ page }) => {
  for (let i = 0; i < 30; i++) put(`More/file-${String(i).padStart(2, '0')}.nsp`, '1');
  await page.goto('/admin/games?tab=folder&path=fb-phone%2FMore');
  await expect(row(page, 'file-00.nsp')).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 900));
  const head = (await page.locator('#fb thead th.c-name').boundingBox())!;
  expect(head.y).toBeGreaterThanOrEqual(50);
  expect(head.y).toBeLessThan(70);
  await page.evaluate(() => window.scrollTo(0, 0));
  for (const id of ['#fb-upb', '#fb-refresh', '#fb-v-list', '#fb-v-grid']) {
    const b = (await page.locator(id).boundingBox())!;
    expect(b.width, id).toBeGreaterThanOrEqual(44);
    expect(b.height, id).toBeGreaterThanOrEqual(44);
  }
  await row(page, 'file-00.nsp').evaluate((n) => n.scrollIntoView({ block: 'center' }));
  const cell = (await row(page, 'file-00.nsp').locator('td.c-sel').boundingBox())!;
  await page.mouse.click(cell.x + 4, cell.y + cell.height - 4);
  await expect(row(page, 'file-00.nsp')).toHaveAttribute('aria-selected', 'true');
});

test('a table on a phone reads as cards with nothing to scroll sideways, and still sorts and filters', async ({ page }) => {
  await page.evaluate(() => {
    const m = document.createElement('div'); m.id = 'card-test'; document.querySelector('main')!.prepend(m);
    const tr = (cells: string[]) => { const r = document.createElement('tr'); for (const c of cells) { const d = document.createElement('td'); if (c === 'BTN') { const b = document.createElement('button'); b.textContent = '지우기'; b.id = 'card-btn'; b.onclick = () => { (window as any).cardHit = true; }; d.append(b); } else d.textContent = c; r.append(d); } return r; };
    (window as any).table('card-test', ['이름', '결과', '아주 긴 설명 열입니다', '날짜', ''], [
      tr(['첫째 항목', '꺼 둠', '이 값은 아주 길어서 데스크톱에서는 넓은 칸을 차지합니다. 폰에서는 줄을 바꿉니다. '.repeat(3), '2026-01-02', 'BTN']),
      tr(['둘째 항목', '켜 둠', '짧음', '2026-01-03', '']),
    ], '없음', {});
  });
  const m = page.locator('#card-test');
  await expect(m.locator('.gcard')).toHaveCount(2);
  await expect(m.locator('.gcard').first().locator('.gcard-t')).toHaveText('첫째 항목');
  await expect(m.locator('.gcard').first()).toContainText('결과');
  const wide = await m.evaluate((n) => [...n.querySelectorAll('*')].filter((e) => getComputedStyle(e).overflowX !== 'hidden' && e.scrollWidth > n.clientWidth + 1).length);
  expect(wide).toBe(0);
  const first = (await m.locator('.gcard').first().boundingBox())!;
  const second = (await m.locator('.gcard').nth(1).boundingBox())!;
  expect(second.y).toBeGreaterThanOrEqual(first.y + first.height);
  await page.locator('#card-btn').click();
  expect(await page.evaluate(() => (window as any).cardHit)).toBe(true);
});

test('an address with no page keeps the admin frame and offers a way on', async ({ page }) => {
  const res = await page.goto('/admin/no-such-page');
  expect(res!.status()).toBe(404);
  await expect(page.getByRole('heading', { name: '찾는 페이지가 없습니다' })).toBeVisible();
  await page.getByRole('link', { name: '관리 홈으로 갑니다' }).click();
  await expect(page).toHaveURL(/[/]admin(#.*)?$/);
  const api = await page.request.get('/admin/api/no-such-thing');
  expect(api.status()).toBe(404);
  expect(await api.text()).not.toContain('adm-shell');
});

test('a swipe across a preview steps to the next file', async ({ page }) => {
  put('Shots/a.txt', 'first');
  put('Shots/b.txt', 'second');
  fs.utimesSync(path.join(base, 'Shots/b.txt'), new Date(0), new Date(0));
  await page.goto('/admin/games?tab=folder&path=fb-phone%2FShots');
  await row(page, 'a.txt').click({ position: { x: 120, y: 10 } });
  const title = page.locator('#fb-v-title');
  const before = await title.textContent();
  await page.evaluate(() => {
    const v = document.getElementById('fb-v-title')!;
    const fire = (type: string, x: number) => v.dispatchEvent(Object.assign(new Event(type, { bubbles: true }), { touches: type === 'touchstart' ? [{ clientX: x, clientY: 100 }] : [], changedTouches: [{ clientX: x, clientY: 100 }] }));
    fire('touchstart', 300);
    fire('touchend', 100);
  });
  await expect(title).not.toHaveText(before!);
});



test('a preview fills the phone, and a lost server leaves the list and the pick on screen', async ({ page }) => {
  put('Pic/a.txt', 'hello');
  await page.goto('/admin/games?tab=folder&path=fb-phone%2FPic');
  await row(page, 'a.txt').click({ position: { x: 120, y: 10 } });
  await expect.poll(async () => (await page.locator('#fb-view').boundingBox())!.width).toBe(390);
  expect((await page.locator('#fb-view').boundingBox())!.height).toBeGreaterThanOrEqual(800);
  await page.keyboard.press('Escape');
  await row(page, 'a.txt').locator('td.c-sel input').check();
  await page.route('**/admin/api/files/list**', (r) => r.abort());
  await page.evaluate(() => (window as any).fbLoad());
  await expect(page.locator('#toast')).toContainText('서버에 연결할 수 없습니다');
  await expect(row(page, 'a.txt')).toHaveAttribute('aria-selected', 'true');
});

test('the header names the page whole on a phone: no group cut to a syllable, no tab repeating the page', async ({ page }) => {
  for (const url of ['/admin/client', '/admin/users', '/admin/settings/notifications']) {
    await page.goto(url);
    const crumb = page.locator('.adm-side .adm-crumb');
    const parts = await crumb.evaluate((c) => [...c.children].filter((n) => n.tagName === 'SPAN' && getComputedStyle(n).display !== 'none').map((n) => ({ text: (n as HTMLElement).innerText.trim(), cut: n.scrollWidth > n.clientWidth + 1 })));
    expect(parts.filter((x) => x.cut && x !== parts[parts.length - 1]), url).toEqual([]);
    const words = parts.map((x) => x.text);
    expect(new Set(words).size, url).toBe(words.length);
  }
});

test('a session that ended says so on the sign-in page', async ({ page, context }) => {
  await page.goto('/admin/games?tab=folder&path=fb-phone');
  await expect(row(page, 'Alpha')).toBeVisible();
  await context.clearCookies();
  await page.evaluate(() => (window as any).fbLoad());
  await expect(page.locator('#err')).toContainText('다시 로그인합니다');
});

test('a second pick leaves every bottom button where it was, rename greyed in its place', async ({ page }) => {
  const bar = page.locator('#fb-pick-acts');
  const places = () => bar.getByRole('button').evaluateAll((bs) => bs.map((b) => { const r = b.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.height)]; }));
  await row(page, 'loose.nsp').click({ position: { x: 120, y: 10 } });
  const one = await places();
  await row(page, LONG).click({ position: { x: 120, y: 10 } });
  await expect(bar.getByRole('button')).toHaveText(['zip으로 내려받기', '이름 바꾸기', '이동', '휴지통으로', '파일 메뉴']);
  await expect(bar.getByRole('button', { name: '이름 바꾸기' })).toBeDisabled();
  expect(await places()).toEqual(one);
});

test('every library tab is on the screen, none behind the right edge', async ({ page }) => {
  const tabs = page.locator('nav.adm-rowtabs a');
  expect(await tabs.count()).toBeGreaterThan(4);
  for (const t of await tabs.all()) {
    const b = (await t.boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(390);
  }
});
