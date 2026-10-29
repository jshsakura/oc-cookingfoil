import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { signIn } from './admin-sign-in';

// The file browser on real folders: open a folder, come back by the path, make a
// folder, rename, move a selection into another folder and send one to the trash.
const games = process.env.COOK_GAMES_DIR!;
const base = path.join(games, 'fb-test');
const put = (rel: string, body = 'x') => {
  fs.mkdirSync(path.dirname(path.join(base, rel)), { recursive: true });
  fs.writeFileSync(path.join(base, rel), body);
};
const has = (rel: string) => fs.existsSync(path.join(base, rel));
const row = (page: import('@playwright/test').Page, name: string) => page.locator('#fb-rows tr', { has: page.getByText(name, { exact: true }) });

test.beforeEach(() => {
  fs.rmSync(base, { recursive: true, force: true });
  put('Alpha/one.nsp', '1');
  put('Alpha/two.nsp', '22');
  put('Beta/keep.txt');
  put('loose.nsp', '333');
});
test.afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

test('a folder opens, the path leads back, and the address keeps the place', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin/games?tab=folder&path=fb-test');
  await expect(row(page, 'Alpha')).toBeVisible();
  await expect(row(page, 'loose.nsp')).toContainText('3 B');
  await row(page, 'Alpha').getByRole('button', { name: 'Alpha' }).click();
  await expect(page).toHaveURL(/path=fb-test%2FAlpha|path=fb-test\/Alpha/);
  await expect(row(page, 'one.nsp')).toBeVisible();
  await page.locator('#fb-crumb').getByRole('button', { name: 'fb-test' }).click();
  await expect(row(page, 'Beta')).toBeVisible();
  await page.goBack();
  await expect(row(page, 'two.nsp')).toBeVisible();
});

test('a new folder, a rename, a move and a trash each change the disk', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin/games?tab=folder&path=fb-test');
  await expect(row(page, 'Alpha')).toBeVisible();

  await page.locator('#fb-mkdir').click();
  await page.locator('#ask-input').fill('Gamma');
  await page.locator('#ask-ok').click();
  await expect(row(page, 'Gamma')).toBeVisible();
  expect(fs.statSync(path.join(base, 'Gamma')).isDirectory()).toBe(true);

  await row(page, 'loose.nsp').getByRole('button', { name: '이름 바꾸기' }).click();
  await page.locator('#ask-input').fill('renamed.nsp');
  await page.locator('#ask-ok').click();
  await expect(row(page, 'renamed.nsp')).toBeVisible();
  expect(has('renamed.nsp') && !has('loose.nsp')).toBe(true);

  await row(page, 'renamed.nsp').locator('input[type=checkbox]').check();
  await row(page, 'Beta').locator('input[type=checkbox]').check();
  await expect(page.locator('#fb-info')).toHaveText('2개를 골랐습니다');
  await page.locator('#fb-move-btn').click();
  await page.locator('#fb-m-list').getByRole('button', { name: 'Gamma' }).click();
  await expect(page.locator('#fb-m-crumb')).toContainText('Gamma');
  await page.locator('#fb-m-ok').click();
  await expect(page.locator('#toast')).toContainText('2개를 옮겼습니다');
  expect(has('Gamma/renamed.nsp') && has('Gamma/Beta/keep.txt')).toBe(true);
  await expect(row(page, 'Beta')).toHaveCount(0);

  await row(page, 'Alpha').getByRole('button', { name: '휴지통으로' }).click();
  await page.locator('#ask-ok').click();
  await expect(row(page, 'Alpha')).toHaveCount(0);
  expect(has('Alpha')).toBe(false);
});

test('rows pick like a file manager: a click picks one, Ctrl adds, Shift takes the range, Ctrl+A takes the page', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin/games?tab=folder&path=fb-test');
  const info = page.locator('#fb-info');
  await row(page, 'Alpha').locator('td.c-size').click();
  await expect(info).toHaveText('1개를 골랐습니다');
  await expect(row(page, 'Alpha')).toHaveAttribute('aria-selected', 'true');
  await row(page, 'loose.nsp').locator('td.c-size').click({ modifiers: ['ControlOrMeta'] });
  await expect(info).toHaveText('2개를 골랐습니다');
  await expect(row(page, 'Beta')).toHaveAttribute('aria-selected', 'false');
  await row(page, 'Alpha').locator('td.c-size').click();
  await row(page, 'loose.nsp').locator('td.c-size').click({ modifiers: ['Shift'] });
  await expect(info).toHaveText('3개를 골랐습니다');
  await row(page, 'Beta').locator('td.c-size').click();
  await expect(info).toHaveText('1개를 골랐습니다');
  await page.keyboard.press('ControlOrMeta+a');
  await expect(info).toHaveText('3개를 골랐습니다');
  await page.keyboard.press('Escape');
  await expect(info).toHaveText('폴더 2개 · 파일 1개');
});

test('the keyboard walks the rows, Enter opens a folder, Backspace goes back up, F2 renames', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin/games?tab=folder&path=fb-test');
  await row(page, 'Alpha').locator('td.c-size').click();
  await page.keyboard.press('ArrowDown');
  await expect(row(page, 'Beta')).toBeFocused();
  await expect(row(page, 'Beta')).toHaveAttribute('aria-selected', 'true');
  await expect(row(page, 'Alpha')).toHaveAttribute('aria-selected', 'false');
  await page.keyboard.press('Enter');
  await expect(row(page, 'keep.txt')).toBeVisible();
  await page.keyboard.press('Backspace');
  await expect(row(page, 'loose.nsp')).toBeVisible();
  await row(page, 'loose.nsp').locator('td.c-size').dblclick();
  await row(page, 'loose.nsp').locator('td.c-size').click();
  await page.keyboard.press('F2');
  await page.locator('#ask-input').fill('keyed.nsp');
  await page.locator('#ask-ok').click();
  await expect(row(page, 'keyed.nsp')).toBeVisible();
  expect(has('keyed.nsp') && !has('loose.nsp')).toBe(true);
});

test('a right click opens a menu of what the pick allows, and on the empty list a new folder and an upload', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin/games?tab=folder&path=fb-test');
  const menu = page.locator('#fb-menu');
  await row(page, 'loose.nsp').locator('td.c-mtime').click({ button: 'right' });
  await expect(menu.getByRole('menuitem')).toHaveText(['내려받기', '잘라내기', '복사', '이름 바꾸기', '이동', '휴지통으로', '속성']);
  await expect(menu.getByRole('menuitem').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();

  await row(page, 'Alpha').locator('td.c-mtime').click({ button: 'right' });
  await expect(menu.getByRole('menuitem')).toHaveText(['열기', 'zip으로 내려받기', '잘라내기', '복사', '이름 바꾸기', '이동', '휴지통으로', '속성']);
  await menu.getByRole('menuitem', { name: '이름 바꾸기' }).click();
  await page.locator('#ask-input').fill('Alef');
  await page.locator('#ask-ok').click();
  await expect(row(page, 'Alef')).toBeVisible();
  expect(has('Alef/one.nsp')).toBe(true);

  await row(page, 'Beta').locator('td.c-size').click();
  await row(page, 'loose.nsp').locator('td.c-size').click({ modifiers: ['ControlOrMeta'] });
  await row(page, 'Beta').locator('td.c-mtime').click({ button: 'right' });
  await expect(menu).toContainText('2개를 골랐습니다');
  await expect(menu.getByRole('menuitem')).toHaveText(['zip으로 내려받기', '잘라내기', '복사', '이동', '휴지통으로', '속성']);
  await page.mouse.click(5, 5);
  await expect(menu).toBeHidden();

  await page.locator('#fb-empty').evaluate((e) => { e.hidden = false; });
  await page.locator('#fb-empty').click({ button: 'right' });
  await expect(menu.getByRole('menuitem')).toHaveText(['새 폴더', '올리기', '폴더 올리기', '되돌리기', '속성']);
  await expect(page.locator('#fb-info')).toHaveText('폴더 2개 · 파일 1개');
});

test('the header row stays in view while the list scrolls, and the bar sits at the bottom', async ({ page }) => {
  for (let i = 0; i < 60; i++) put(`Many/file-${String(i).padStart(2, '0')}.nsp`);
  await page.setViewportSize({ width: 1280, height: 720 });
  await signIn(page);
  await page.goto('/admin/games?tab=folder&path=fb-test%2FMany');
  await expect(row(page, 'file-59.nsp')).toBeVisible();
  await page.mouse.wheel(0, 1500);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
  const head = await page.locator('#fb thead th.c-name').boundingBox();
  const bar = await page.locator('#fb-foot').boundingBox();
  expect(head!.y).toBeGreaterThanOrEqual(60);
  expect(head!.y).toBeLessThan(80);
  expect(Math.round(bar!.y + bar!.height)).toBe(720);
  if (process.env.FB_SHOTS) await page.screenshot({ path: path.join(process.env.FB_SHOTS, 'files-desktop.png') });
});

test('on a phone the list fits the width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await page.goto('/admin/games?tab=folder&path=fb-test');
  await expect(row(page, 'Alpha')).toBeVisible();
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(390);
  if (process.env.FB_SHOTS) await page.screenshot({ path: path.join(process.env.FB_SHOTS, 'files-phone.png') });
});

test('files dropped on the list or picked with Upload land in the open folder, in pieces', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin/games?tab=folder&path=fb-test%2FBeta');
  await expect(row(page, 'keep.txt')).toBeVisible();
  await page.evaluate(() => { (window as any).UP_CHUNK_BYTES = 4; });

  await page.locator('#fb-file').setInputFiles([{ name: 'picked.nsp', mimeType: 'application/octet-stream', buffer: Buffer.from('0123456789') }]);
  await expect(page.locator('#toast')).toContainText('1개를 올렸습니다');
  await expect(row(page, 'picked.nsp')).toBeVisible();
  expect(fs.readFileSync(path.join(base, 'Beta/picked.nsp'), 'utf8')).toBe('0123456789');

  const drop = await page.evaluateHandle(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['dropped bytes'], 'dropped.nsp'));
    dt.items.add(new File(['NEW'], 'keep.txt'));
    return dt;
  });
  await page.locator('#fb .fb-wrap').dispatchEvent('dragenter', { dataTransfer: drop });
  await expect(page.locator('#fb')).toHaveClass(/dragging/);
  await page.locator('#fb .fb-wrap').dispatchEvent('drop', { dataTransfer: drop });
  await expect(page.locator('#toast')).toContainText('1개를 올렸습니다. 1개는 같은 이름이 이미 있어 건너뛰었습니다');
  await expect(page.locator('#fb')).not.toHaveClass(/dragging/);
  expect(fs.readFileSync(path.join(base, 'Beta/dropped.nsp'), 'utf8')).toBe('dropped bytes');
  expect(fs.readFileSync(path.join(base, 'Beta/keep.txt'), 'utf8')).toBe('x');
});

test('a picked folder keeps its shape, and the upload panel stops a file that has not finished', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin/games?tab=folder&path=fb-test%2FBeta');
  await expect(row(page, 'keep.txt')).toBeVisible();
  await page.evaluate(() => { (window as any).UP_CHUNK_BYTES = 4; });
  // A picked folder names its files under it, as the browser does with webkitRelativePath.
  await page.locator('#fb-dir').evaluate((input: HTMLInputElement) => {
    const dt = new DataTransfer();
    for (const [rel, body] of [['Pack/a.nsp', 'aaa'], ['Pack/sub/b.nsp', 'bb']]) {
      const f = new File([body], rel.split('/').pop()!);
      Object.defineProperty(f, 'webkitRelativePath', { value: rel });
      dt.items.add(f);
    }
    input.files = dt.files;
    input.dispatchEvent(new Event('change'));
  });
  await expect(page.locator('#toast')).toContainText('2개를 올렸습니다');
  expect(fs.readFileSync(path.join(base, 'Beta/Pack/sub/b.nsp'), 'utf8')).toBe('bb');
  const panel = page.locator('#fb-upl');
  await expect(panel.locator('li')).toHaveCount(2);
  await expect(panel.locator('li[data-state="done"]')).toHaveCount(2);

  // Every piece waits on the server until the test lets it go, so the second file is still waiting when stopped.
  let release!: () => void;
  const gate = new Promise<void>((ok) => { release = ok; });
  await page.route('**/admin/api/upload/chunks/**', async (route) => { await gate; await route.continue(); });
  await page.locator('#fb-file').setInputFiles([
    { name: 'slow.nsp', mimeType: 'application/octet-stream', buffer: Buffer.from('0123456789') },
    { name: 'never.nsp', mimeType: 'application/octet-stream', buffer: Buffer.from('nope') },
  ]);
  const never = panel.locator('li', { hasText: 'never.nsp' });
  await expect(never).toHaveAttribute('data-state', 'wait');
  await never.getByRole('button').click();
  await expect(never).toHaveAttribute('data-state', 'stop');
  release();
  await expect(panel.locator('li', { hasText: 'slow.nsp' })).toHaveAttribute('data-state', 'done');
  await expect(page.locator('#fb-up-close')).toBeVisible();
  expect(has('Beta/slow.nsp') && !has('Beta/never.nsp')).toBe(true);
  await page.locator('#fb-up-close').click();
  await expect(panel).toBeHidden();
});

test('rows dragged onto a folder or onto the path move there', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin/games?tab=folder&path=fb-test');
  await row(page, 'loose.nsp').locator('td.c-size').dragTo(row(page, 'Alpha').locator('td.c-size'));
  await expect(page.locator('#toast')).toContainText('1개를 옮겼습니다');
  await expect(row(page, 'loose.nsp')).toHaveCount(0);
  expect(has('Alpha/loose.nsp')).toBe(true);

  await row(page, 'Alpha').getByRole('button', { name: 'Alpha' }).click();
  await expect(row(page, 'one.nsp')).toBeVisible();
  await row(page, 'one.nsp').locator('td.c-size').click();
  await row(page, 'two.nsp').locator('td.c-size').click({ modifiers: ['ControlOrMeta'] });
  await row(page, 'two.nsp').locator('td.c-size').dragTo(page.locator('#fb-crumb').getByRole('button', { name: 'fb-test' }));
  await expect(page.locator('#toast')).toContainText('2개를 옮겼습니다');
  expect(has('one.nsp') && has('two.nsp') && !has('Alpha/one.nsp')).toBe(true);
});

test('a pick comes down as one zip, and a text or image file opens in a preview', async ({ page }) => {
  put('notes.txt', 'line one\nline two');
  put('cover.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="red"/></svg>');
  await signIn(page);
  await page.goto('/admin/games?tab=folder&path=fb-test');
  await row(page, 'Alpha').locator('td.c-size').click();
  await row(page, 'loose.nsp').locator('td.c-size').click({ modifiers: ['ControlOrMeta'] });
  const download = page.waitForEvent('download');
  await page.locator('#fb-zip-btn').click();
  const zip = await download;
  expect(zip.suggestedFilename()).toBe('fb-test.zip');
  const bytes = fs.readFileSync((await zip.path())!);
  expect(bytes.subarray(0, 2).toString()).toBe('PK');
  expect(bytes.includes(Buffer.from('Alpha/two.nsp'))).toBe(true);

  await row(page, 'notes.txt').locator('td.c-size').dblclick();
  const view = page.locator('#fb-view');
  await expect(view.locator('pre')).toHaveText('line one\nline two');
  await page.keyboard.press('ArrowLeft');
  await expect(view.locator('img')).toHaveAttribute('src', /^blob:/);
  await expect(page.locator('#fb-v-title')).toHaveText('cover.svg');
  await page.keyboard.press('Escape');
  await expect(view).toBeHidden();
  await expect(row(page, 'cover.svg')).toBeFocused();
});

test('copy and paste make a numbered copy, cut and paste move, and Ctrl+Z takes each back', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin/games?tab=folder&path=fb-test');
  await row(page, 'loose.nsp').locator('td.c-size').click();
  await page.keyboard.press('ControlOrMeta+c');
  await page.keyboard.press('ControlOrMeta+v');
  await expect(row(page, 'loose (2).nsp')).toBeVisible();
  expect(fs.readFileSync(path.join(base, 'loose (2).nsp'), 'utf8')).toBe('333');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(row(page, 'loose (2).nsp')).toHaveCount(0);
  expect(has('loose (2).nsp')).toBe(false);

  await row(page, 'loose.nsp').locator('td.c-size').click();
  await page.keyboard.press('ControlOrMeta+x');
  await expect(row(page, 'loose.nsp')).toHaveClass(/fb-cut/);
  await row(page, 'Beta').getByRole('button', { name: 'Beta' }).click();
  await expect(row(page, 'keep.txt')).toBeVisible();
  await page.locator('#fb-rows tr').first().focus();
  await page.keyboard.press('ControlOrMeta+v');
  await expect(row(page, 'loose.nsp')).toBeVisible();
  expect(has('Beta/loose.nsp') && !has('loose.nsp')).toBe(true);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(row(page, 'loose.nsp')).toHaveCount(0);
  expect(has('loose.nsp') && !has('Beta/loose.nsp')).toBe(true);

  await row(page, 'keep.txt').locator('td.c-size').click();
  await page.keyboard.press('Delete');
  await page.locator('#ask-ok').click();
  await expect(row(page, 'keep.txt')).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(row(page, 'keep.txt')).toBeVisible();
  expect(has('Beta/keep.txt')).toBe(true);
});

test('back, forward and up walk the folders, and a typed address opens one', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin/games?tab=folder&path=fb-test');
  await expect(page.locator('#fb-back')).toBeDisabled();
  await row(page, 'Alpha').getByRole('button', { name: 'Alpha' }).click();
  await expect(row(page, 'one.nsp')).toBeVisible();
  await page.locator('#fb-back').click();
  await expect(row(page, 'loose.nsp')).toBeVisible();
  await page.locator('#fb-fwd').click();
  await expect(row(page, 'one.nsp')).toBeVisible();
  await page.locator('#fb-upb').click();
  await expect(row(page, 'Beta')).toBeVisible();

  const crumb = (await page.locator('#fb-crumb').boundingBox())!;
  await page.mouse.click(crumb.x + crumb.width - 6, crumb.y + crumb.height / 2);
  await expect(page.locator('#fb-addr')).toBeFocused();
  await page.locator('#fb-addr').fill('/fb-test/Beta');
  await page.keyboard.press('Enter');
  await expect(row(page, 'keep.txt')).toBeVisible();
  await expect(page.locator('#fb-crumb')).toBeVisible();
});

test('a search through subfolders shows where each find is, and properties count through folders', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin/games?tab=folder&path=fb-test');
  await page.locator('#fb-deep').check();
  await page.locator('#fb-q').fill('two');
  await expect(row(page, 'two.nsp')).toBeVisible();
  await expect(row(page, 'two.nsp').locator('.fb-where')).toHaveText('fb-test/Alpha');
  await page.locator('#fb-q').fill('');
  await expect(row(page, 'Alpha')).toBeVisible();

  await row(page, 'Alpha').locator('td.c-size').click();
  await page.keyboard.press('Alt+Enter');
  const props = page.locator('#fb-props');
  await expect(props).toContainText('3 B (3바이트)');
  await expect(props).toContainText('파일 2개, 폴더 0개');
  await page.locator('#fb-p-ok').click();
  await expect(props).toBeHidden();
});

test('the icon view tiles the rows, letters jump to a name, and a box drawn on empty space picks rows', async ({ page }) => {
  put('cover.png', 'not really a png');
  await signIn(page);
  await page.goto('/admin/games?tab=folder&path=fb-test');
  await page.locator('#fb-v-grid').click();
  await expect(page.locator('#fb')).toHaveClass(/grid/);
  await expect(page.locator('#fb thead')).toBeHidden();
  await row(page, 'Alpha').locator('.fb-name').click();
  await page.keyboard.press('l');
  await expect(row(page, 'loose.nsp')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(row(page, 'cover.png')).toBeFocused();
  await page.reload();
  await expect(page.locator('#fb')).toHaveClass(/grid/);

  const wrap = await page.locator('#fb .fb-wrap').boundingBox();
  const last = await row(page, 'loose.nsp').boundingBox();
  await page.mouse.move(wrap!.x + wrap!.width - 4, last!.y + last!.height + 2);
  await page.mouse.down();
  await page.mouse.move(wrap!.x + 4, wrap!.y + 4, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('#fb-info')).toHaveText('4개를 골랐습니다');
  await page.locator('#fb-v-list').click();
  await expect(page.locator('#fb')).not.toHaveClass(/grid/);
});

test('another folder shows placeholder rows while it loads, and a title id folder reads as its game', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin/games?tab=folder&path=fb-test');
  await expect(row(page, 'Alpha')).toBeVisible();
  let release = () => {};
  const held = new Promise<void>((ok) => { release = ok; });
  await page.route('**/admin/api/files/list?*', async (r) => {
    if (!r.request().url().includes('Alpha')) return r.continue();
    await held;
    return r.fulfill({ json: { root: 'games', path: 'fb-test/Alpha', parent: 'fb-test', total: 1, page: 1, perPage: 100, pages: 1,
      deep: false, cut: false, counts: { dirs: 1, files: 0 },
      items: [{ name: '0100AAAA00000000', rel: 'fb-test/Alpha/0100AAAA00000000', type: 'dir', size: null, mtime: Date.now(), ext: null, title: 'Alpha Quest' }] } });
  });
  await row(page, 'Alpha').getByRole('button', { name: 'Alpha' }).click();
  await expect(page.locator('#fb-rows tr.fb-skel').first()).toBeVisible();
  release();
  await expect(page.locator('#fb-rows tr.fb-skel')).toHaveCount(0);
  const game = page.locator('#fb-rows tr', { has: page.getByRole('button', { name: 'Alpha Quest' }) });
  await expect(game).toContainText('0100AAAA00000000');
});

test('on a wide screen the folder tree and the details pane open beside the list', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await signIn(page);
  await page.goto('/admin/games?tab=folder&path=fb-test');
  const tree = page.locator('#fb-tree');
  await expect(tree.locator('[aria-current="page"]')).toContainText('fb-test');
  await expect(tree.getByRole('button', { name: 'Beta', exact: true })).toBeVisible();
  await tree.getByRole('button', { name: 'Beta', exact: true }).click();
  await expect(row(page, 'keep.txt')).toBeVisible();
  await expect(tree.locator('[aria-current="page"]')).toContainText('Beta');
  await page.goBack();
  const side = page.locator('#fb-side');
  await expect(side).toContainText('항목을 고르면');
  await row(page, 'loose.nsp').locator('.fb-name').click();
  await expect(side.getByRole('heading', { name: 'loose.nsp' })).toBeVisible();
  await expect(side).toContainText('3 B');
  await row(page, 'Alpha').locator('.c-size').click();
  await side.getByRole('button', { name: '크기 계산' }).click();
  await expect(side).toContainText('파일 2개');
  await page.locator('#fb-t-side').click();
  await expect(side).toBeHidden();
  await page.reload();
  await expect(page.locator('#fb-side')).toBeHidden();
  await expect(page.locator('#fb-tree')).toBeVisible();
});

test('a long folder keeps loading as it scrolls instead of paging', async ({ page }) => {
  for (let i = 0; i < 150; i++) put(`Many/f${String(i).padStart(3, '0')}.nsp`);
  await signIn(page);
  await page.goto('/admin/games?tab=folder&path=fb-test%2FMany');
  await expect(page.locator('#fb-rows tr')).toHaveCount(100);
  await expect(page.locator('#fb-info')).toContainText('100개 표시');
  await page.locator('#fb-more').scrollIntoViewIfNeeded();
  await expect(page.locator('#fb-rows tr')).toHaveCount(150);
  await expect(page.locator('#fb-info')).not.toContainText('표시');
});

test("a game file shows its game's icon, kind, version and what its check found", async ({ page }) => {
  await signIn(page);
  expect((await page.request.get('/api/library/icon/0100000000010000?size=sm')).status()).not.toBe(401);
  await page.route('**/admin/api/files/list?*', (r) => {
    if (!r.request().url().includes('Gamey')) return r.continue();
    return r.fulfill({ json: { root: 'games', path: 'fb-test/Gamey', parent: 'fb-test', total: 1, page: 1, perPage: 100, pages: 1, deep: false, cut: false,
      counts: { dirs: 0, files: 1 },
      items: [{ name: 'Gamey [0100AAAA00000800][v65536].nsp', rel: 'fb-test/Gamey/Gamey [0100AAAA00000800][v65536].nsp', type: 'file', size: 10, mtime: Date.now(), ext: 'nsp',
        titleId: '0100AAAA00000000', kind: 'update', version: 65536, latest: false, check: 'damaged' }] } });
  });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
  await page.route('**/api/library/icon/**', (r) => r.fulfill({ contentType: 'image/png', body: png }));
  await page.goto('/admin/games?tab=folder&path=fb-test%2FGamey');
  const r = page.locator('#fb-rows tr').first();
  await expect(r.locator('img.fb-gicon')).toHaveAttribute('src', /\/api\/library\/icon\/0100AAAA00000000\?size=sm/);
  await expect(r).toContainText('업데이트 v65536');
  await expect(r).toContainText('구버전');
  await expect(r).toContainText('손상');
});
