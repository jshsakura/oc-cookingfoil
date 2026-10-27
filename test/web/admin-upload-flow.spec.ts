import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { signIn } from './admin-sign-in';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const GAMES = process.env.COOK_GAMES_DIR!;
const SAVES = process.env.COOK_SAVES_DIR!;
const pkg = (name: string) => ({ name, mimeType: 'application/octet-stream', buffer: Buffer.from('x') });
const nsp = (tag: string) => `E2E Flow ${tag} [0100000000${60 + tag.length}0000][v0].nsp`;
// The file names of every unit the page sends, in order: the files it started in pieces since the last finish
// (the page's XHR is wrapped before it loads).
const posts = async (page: Page) => {
  const wrap = () => {
    const w = window as unknown as { __sent: string[] };
    w.__sent = [];
    let started: string[] = [];
    const open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method: string, url: string | URL, ...rest: unknown[]) {
      (this as unknown as { __url: string }).__url = String(url);
      return (open as (...a: unknown[]) => void).call(this, method, url, ...rest);
    };
    const send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function (body) {
      const url = (this as unknown as { __url: string }).__url;
      if (url.endsWith('/chunks') && typeof body === 'string') {
        const name = JSON.parse(body).name as string;
        if (!started.includes(name)) started.push(name);
      }
      if (url.endsWith('/finish')) { w.__sent.push(started.join('|')); started = []; }
      return send.call(this, body as XMLHttpRequestBodyInit);
    };
  };
  await page.addInitScript(wrap);
  await page.evaluate(wrap);
  return () => page.evaluate(() => (window as unknown as { __sent: string[] }).__sent);
};
const gone = (names: string[]) => { for (const n of names) fs.rmSync(path.join(GAMES, n), { force: true }); };

test('a quick file pick shares the initial target request and keeps the selected files', async ({ page }) => {
  await signIn(page);
  let requests = 0;
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/admin/api/upload/targets', async (route) => {
    requests++;
    await gate;
    await route.continue();
  });
  try {
    await page.goto('/admin/upload');
    await expect.poll(() => requests).toBe(1);
    await page.locator('#up-file').setInputFiles([pkg(nsp('Quick'))]);
    await page.waitForTimeout(100);
    expect(requests).toBe(1);
  } finally {
    release();
  }
  await expect(page.locator('#up-chosen')).toContainText('E2E Flow Quick');
  await expect(page.getByRole('button', { name: '올리기', exact: true })).toBeVisible();
});

test.afterEach(() => {
  gone(fs.readdirSync(GAMES).filter((n) => n.startsWith('E2E Flow')));
  fs.rmSync(path.join(SAVES, '0100000000010000', 'Flow save'), { recursive: true, force: true });
});

for (const [label, size] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1280, height: 800 }]] as const) {
  test(`${label}: the chooser opens the page and nothing else is offered before a file is picked`, async ({ page }) => {
    await page.setViewportSize(size);
    await signIn(page);
    await page.goto('/admin#upload');
    const drop = page.locator('#up-drop');
    await expect(drop).toBeVisible();
    const box = (await drop.boundingBox())!;
    expect(box.y).toBeLessThan(size.height / 2);
    expect(box.y + box.height).toBeLessThanOrEqual(size.height);
    await expect(page.locator('#up-kinds')).toBeHidden();
    await expect(page.locator('#up-systems [data-system]').first()).toBeHidden();
    await expect(page.locator('#up-form')).toBeHidden();
    await page.locator('#up-file').setInputFiles(pkg(nsp('A')));
    await expect(page.locator('#up-guess-t')).toContainText('읽은 종류: 패키지');
    await expect(page.locator('#up-plan')).toContainText('게임 폴더에 이 이름 그대로');
    await expect(page.locator('#up-plan')).toContainText('덮어쓰지 않고 거절');
    // Only the one-line suggestion is shown, not the list of kinds.
    await expect(page.locator('#up-kinds')).toBeHidden();
    const noSideScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(noSideScroll).toBe(true);
    fs.mkdirSync('out/web', { recursive: true });
    await page.screenshot({ path: `out/web/admin-upload-flow-${label}.png`, fullPage: true });
    // "바꾸기" opens the kinds, never the 40 odd consoles.
    await page.locator('#up-change').click();
    await expect(page.locator('#up-kinds')).toBeVisible();
    await expect(page.locator('#up-systems-wrap')).toBeHidden();
    await page.screenshot({ path: `out/web/admin-upload-flow-${label}-kinds.png`, fullPage: true });
  });
}

test('a ROM whose extension several consoles use is not decided for the admin', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin#upload');
  await page.locator('#up-file').setInputFiles(pkg('Sonic.bin'));
  await expect(page.locator('#up-guess-t')).toContainText('여러 기종이 씁니다');
  await expect(page.locator('#up-go')).toBeDisabled();
  const shown = page.locator('#up-systems [data-system]:visible');
  expect(await shown.count()).toBeGreaterThan(0);
  expect(await shown.count()).toBeLessThan(await page.locator('#up-systems [data-system]').count());
  await expect(page.locator('#up-systems .up-more-sys')).toBeVisible();
  await expect(page.locator('#up-systems [aria-pressed="true"]')).toHaveCount(0);
});

test('files of different kinds are not guessed as one', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin#upload');
  await page.locator('#up-file').setInputFiles([pkg(nsp('A')), pkg('Mario.sfc')]);
  await expect(page.locator('#up-guess-t')).toContainText('종류가 다른 파일이 섞여 있습니다');
  await expect(page.locator('#up-kinds')).toBeVisible();
  await expect(page.locator('#up-kinds [aria-pressed="true"]')).toHaveCount(0);
  await expect(page.locator('#up-go')).toBeDisabled();
});

test('a duplicate is refused with its reason, the others go up, and the retry sends only the failed one', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await page.goto('/admin#upload');
  const names = [nsp('A'), nsp('BB'), nsp('CCC')];
  fs.writeFileSync(path.join(GAMES, names[1]), '');
  const seen = await posts(page);
  await page.locator('#up-file').setInputFiles(names.map(pkg));
  await expect(page.locator('#up-hint')).toContainText('3개를 하나씩');
  await page.getByRole('button', { name: '올리기', exact: true }).click();
  await expect(page.locator('#up-log .note:not(.warn)')).toHaveCount(2);
  const failed = page.locator('#up-log .note.warn');
  await expect(failed).toHaveCount(1);
  await expect(failed).toContainText('올리지 못했습니다');
  await expect(failed).toContainText('이미 있습니다');
  await expect(failed).toContainText('같은 이름이 이미 있어 거절됐습니다');
  await expect(page.locator('#up-sum')).toContainText('성공 2개 · 실패 1개');
  await expect(page.locator('#up-sum')).toContainText('성공한 것은 다시 올리지 않습니다');
  expect(await seen()).toEqual(names);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  fs.mkdirSync('out/web', { recursive: true });
  await page.screenshot({ path: 'out/web/admin-upload-flow-partial-phone.png', fullPage: true });
  expect(fs.existsSync(path.join(GAMES, names[0]))).toBe(true);
  // The retry is offered for the failed one only; the name is still taken, so it fails again, and nothing else is sent.
  const retry = page.getByRole('button', { name: '실패한 1개만 다시 올리기' });
  await expect(retry).toBeVisible();
  await retry.click();
  await expect(page.locator('#up-sum')).toContainText('성공 2개 · 실패 1개');
  await expect.poll(async () => (await seen()).length).toBe(4);
  expect((await seen())[3]).toBe(names[1]);
  // Freeing the name and retrying finishes the batch without touching the two that went up.
  fs.rmSync(path.join(GAMES, names[1]));
  await page.getByRole('button', { name: '실패한 1개만 다시 올리기' }).click();
  await expect(page.locator('#up-log .note.warn')).toHaveCount(0);
  await expect(page.locator('#up-log .note')).toHaveCount(3);
  expect((await seen()).slice(4)).toEqual([names[1]]);
  expect(await seen()).toHaveLength(5);
  await expect(page.locator('#up-form')).toBeHidden();
  await expect(page.locator('#up-sum')).toContainText('성공 3개 · 실패 0개');
});

test('a lost connection is told apart from a refusal, and the row retries by itself', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin#upload');
  const names = [nsp('A'), nsp('BB')];
  const seen = await posts(page);
  // Every piece of the second file is lost until the connection comes back.
  await page.addInitScript(() => { (window as unknown as { UP_RETRY_MS: number }).UP_RETRY_MS = 5; });
  await page.evaluate(() => { (window as unknown as { UP_RETRY_MS: number }).UP_RETRY_MS = 5; });
  let down = true;
  await page.route('**/admin/api/upload/game/chunks', async (route) => {
    if (down && (route.request().postData() ?? '').includes(names[1])) { await route.abort('connectionreset'); return; }
    await route.continue();
  });
  await page.locator('#up-file').setInputFiles(names.map(pkg));
  await page.getByRole('button', { name: '올리기', exact: true }).click();
  const failed = page.locator('#up-log .note.warn');
  await expect(failed).toHaveCount(1);
  await expect(failed).toContainText('서버에 닿지 못했습니다');
  await expect(page.locator('#up-log .note:not(.warn)')).toHaveCount(1);
  down = false;
  await failed.getByRole('button', { name: '다시 시도' }).click();
  await expect(page.locator('#up-log .note.warn')).toHaveCount(0);
  await expect(page.locator('#up-log .note:not(.warn)')).toHaveCount(2);
  expect(await seen()).toEqual([names[0], names[1]]);
});

test('a folder is one request with its own result, and the language switch repaints the page', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin#upload');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-flow-'));
  try {
    fs.mkdirSync(`${dir}/Flow save`, { recursive: true });
    fs.writeFileSync(`${dir}/Flow save/userdata.dat`, 'x');
    fs.writeFileSync(`${dir}/Flow save/extra.dat`, 'y');
    const seen = await posts(page);
    await page.locator('#up-dir').setInputFiles(`${dir}/Flow save`);
    await expect(page.locator('#up-guess-t')).toContainText('읽은 종류: 세이브');
    await expect(page.locator('#up-chosen')).toContainText('Flow save/');
    await page.locator('#up-game').fill('Test Game [0100000000010000]');
    await page.locator('#up-game').dispatchEvent('input');
    await expect(page.locator('#up-plan')).toContainText('세이브 폴더 안의 그 게임 폴더');
    // Language: the new strings follow the page language.
    await page.locator('#lang-btn').click();
    await page.locator('[data-admin-lang="en"]').click();
    await expect(page.locator('#up-guess-t')).toContainText('Detected kind: Save');
    await expect(page.locator('#up-plan')).toContainText("Goes straight into that game's folder");
    await page.locator('#lang-btn').click();
    await page.locator('[data-admin-lang="ko"]').click();
    await expect(page.locator('#up-guess-t')).toContainText('읽은 종류: 세이브');
    await page.getByRole('button', { name: '올리기', exact: true }).click();
    await expect(page.locator('#up-log .note:not(.warn)')).toHaveCount(1);
    await expect(page.locator('#up-log .note')).toContainText('파일 2개');
    expect(await seen()).toHaveLength(1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const created = (where: string) => ({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true, kind: 'game', where, files: 1 }) });

test('51 packages with the first refused keep the failed row on screen next to the 50 that went up', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin#upload');
  const names = Array.from({ length: 51 }, (_, i) => `E2E Flow N${String(i).padStart(2, '0')} [0100000000${70 + (i % 20)}0000][v0].nsp`);
  let finishes = 0;
  await page.route('**/admin/api/upload/game/finish', async (route) => {
    if (finishes++ === 0) await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: `이미 있습니다: ${names[0]}`, code: 'upload.exists' }) });
    else await route.fulfill(created('x'));
  });
  await page.locator('#up-file').setInputFiles(names.map(pkg));
  await page.getByRole('button', { name: '올리기', exact: true }).click();
  await expect(page.locator('#up-sum')).toContainText('성공 50개 · 실패 1개');
  await expect(page.locator('#up-log .note.warn')).toHaveCount(1);
  await expect(page.locator('#up-log .note.warn')).toContainText(names[0]);
  await expect(page.locator('#up-log .note.warn').getByRole('button', { name: '다시 시도' })).toBeVisible();
  await expect(page.locator('#up-log .note')).toHaveCount(51);
});

test('while files are going up the kind, console and target cannot be changed, and every request goes where the batch was made', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin#upload');
  const names = [nsp('A'), nsp('BB')];
  const urls: string[] = [];
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => { release = r; });
  await page.route('**/admin/api/upload/**', async (route) => {
    if (!route.request().url().endsWith('/finish')) return route.continue();
    urls.push(new URL(route.request().url()).pathname);
    if (urls.length === 1) await gate;
    await route.fulfill(created('x'));
  });
  await page.locator('#up-file').setInputFiles(names.map(pkg));
  await page.getByRole('button', { name: '올리기', exact: true }).click();
  await expect(page.locator('#up-change')).toBeDisabled();
  await expect(page.locator('#up-file-btn')).toBeDisabled();
  await expect(page.locator('#up-dir-btn')).toBeDisabled();
  await expect(page.locator('#up-kinds button').first()).toBeDisabled();
  await page.locator('#up-change').click({ force: true });
  await expect(page.locator('#up-kinds')).toBeHidden();
  release();
  await expect(page.locator('#up-sum')).toContainText('성공 2개 · 실패 0개');
  expect(urls).toEqual(['/admin/api/upload/game/finish', '/admin/api/upload/game/finish']);
  await expect(page.locator('#up-change')).toBeHidden();
});

test('a folder is not guessed as a save without a reason, a folder of packages reads as packages without a false warning, and batch counts say batches and files', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin#upload');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-flow-'));
  try {
    fs.mkdirSync(`${dir}/Documents`);
    fs.writeFileSync(`${dir}/Documents/notes.txt`, 'x');
    await page.locator('#up-dir').setInputFiles(`${dir}/Documents`);
    await expect(page.locator('#up-guess-t')).toContainText('종류를 알 수 없습니다');
    await expect(page.locator('#up-go')).toBeDisabled();
    fs.mkdirSync(`${dir}/Pkgs`);
    for (const n of ['A', 'BB']) fs.writeFileSync(`${dir}/Pkgs/${nsp(n)}`, 'x');
    await page.locator('#up-dir').setInputFiles(`${dir}/Pkgs`);
    await expect(page.locator('#up-guess-t')).toContainText('읽은 종류: 패키지');
    await expect(page.locator('#up-guess-t')).not.toContainText('다른 종류');
    // A save folder is one batch of two files: the summary says so and the files can be unfolded.
    fs.mkdirSync(`${dir}/Flow save`);
    fs.writeFileSync(`${dir}/Flow save/userdata.dat`, 'x');
    fs.writeFileSync(`${dir}/Flow save/extra.dat`, 'y');
    await page.locator('#up-dir').setInputFiles(`${dir}/Flow save`);
    await page.locator('#up-game').fill('Test Game [0100000000010000]');
    await page.locator('#up-game').dispatchEvent('input');
    await page.getByRole('button', { name: '올리기', exact: true }).click();
    await expect(page.locator('#up-sum')).toContainText('성공 1묶음(파일 2개) · 실패 0묶음(파일 0개)');
    await expect(page.locator('#up-log .note details summary')).toContainText('묶음 안의 파일 2개');
    // The finished summary survives a language switch.
    await page.locator('#lang-btn').click();
    await page.locator('[data-admin-lang="en"]').click();
    await expect(page.locator('#up-sum')).toContainText('1 batch (2 files) sent');
    await page.locator('#lang-btn').click();
    await page.locator('[data-admin-lang="ko"]').click();
    await expect(page.locator('#up-sum')).toContainText('성공 1묶음(파일 2개)');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('80 packages that all go up keep all 80 rows', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin#upload');
  await page.route('**/admin/api/upload/game/finish', (route) => route.fulfill(created('x')));
  const names = Array.from({ length: 80 }, (_, i) => `E2E Flow M${String(i).padStart(2, '0')} [0100000000${70 + (i % 20)}0000][v0].nsp`);
  await page.locator('#up-file').setInputFiles(names.map(pkg));
  await page.getByRole('button', { name: '올리기', exact: true }).click();
  await expect(page.locator('#up-sum')).toContainText('성공 80개 · 실패 0개');
  await expect(page.locator('#up-log .note')).toHaveCount(80);
});

test('an app-card entry while files are going up waits, then opens with the app and kind chosen', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin#upload');
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => { release = r; });
  await page.route('**/admin/api/upload/game/finish', async (route) => { await gate; await route.fulfill(created('x')); });
  await page.locator('#up-file').setInputFiles([pkg(nsp('A'))]);
  await page.getByRole('button', { name: '올리기', exact: true }).click();
  await expect(page.locator('#up-change')).toBeDisabled();
  await page.evaluate(() => (window as unknown as { uploadFor: (k: string, a: string) => void }).uploadFor('patch', 'handapp'));
  // Still the package batch: nothing of the entry was applied yet.
  await expect(page.locator('#up-target')).toHaveValue('');
  release();
  await expect(page.locator('#up-log .note:not(.warn)')).toHaveCount(1);
  await expect(page.locator('#up-target')).toHaveValue('handapp');
  await expect(page.locator('#up-hint')).toContainText('홈브류 앱의 패치');
  await expect(page.locator('#up-sum')).toContainText('성공 1개');
});

test('a file goes up in several pieces and a lost piece is picked up again from the server\'s offset', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin#upload');
  const name = nsp('Chunked');
  const size = 1000;
  const answers: number[] = [];
  page.on('response', (r) => { if (r.request().method() === 'PUT' && r.url().includes('/upload/chunks/')) answers.push(r.status()); });
  const offsets: string[] = [];
  const set = (n: number) => page.evaluate((v) => { (window as unknown as { UP_CHUNK_BYTES: number }).UP_CHUNK_BYTES = v; (window as unknown as { UP_RETRY_MS: number }).UP_RETRY_MS = 5; }, n);
  await expect(page.locator('#up-drop')).toBeVisible();
  await set(300);
  let lost = false;
  await page.route('**/admin/api/upload/chunks/**', async (route) => {
    if (route.request().method() !== 'PUT') return route.continue();
    offsets.push(new URL(route.request().url()).searchParams.get('offset')!);
    // The server gets the second piece, but the page never hears back: it asks again and is told where the file stands.
    if (!lost && offsets.length === 2) { lost = true; await route.fetch(); await route.abort('connectionreset'); return; }
    await route.continue();
  });
  await page.locator('#up-file').setInputFiles({ name, mimeType: 'application/octet-stream', buffer: Buffer.alloc(size, 7) });
  await page.getByRole('button', { name: '올리기', exact: true }).click();
  await expect(page.locator('#up-sum')).toContainText('성공 1개 · 실패 0개');
  expect(lost).toBe(true);
  // The piece the page never heard about was told apart by a 409 that carried the real offset.
  expect(answers).toContain(409);
  expect(offsets.slice(0, 2)).toEqual(['0', '300']);
  expect(fs.readFileSync(path.join(GAMES, name)).equals(Buffer.alloc(size, 7))).toBe(true);
});

test('a patch zip goes up with no game and no name picked: its own title folder names the game, its file name the patch', async ({ page }) => {
  const PATCHES = process.env.COOK_PATCHES_DIR!;
  const tid = '0100152000022000';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-patch-'));
  fs.mkdirSync(path.join(dir, '한글', 'contents', tid, 'romfs'), { recursive: true });
  fs.writeFileSync(path.join(dir, '한글', 'contents', tid, 'romfs', 'text.bin'), 'KO');
  fs.writeFileSync(path.join(dir, '한글', '설치방법.txt'), 'note');
  const zip = path.join(dir, 'E2E 대충 패치.zip');
  execFileSync('zip', ['-qr', zip, '한글'], { cwd: dir });
  const landed = path.join(PATCHES, tid, 'E2E 대충 패치');
  fs.rmSync(landed, { recursive: true, force: true });
  try {
    await signIn(page);
    await page.goto('/admin#upload');
    await page.locator('#up-file').setInputFiles(zip);
    await page.locator('#up-kinds [data-kind="patch"]').click();
    await page.locator('#up-go').click();
    await expect.poll(() => fs.existsSync(path.join(landed, 'atmosphere', 'contents', tid, 'romfs', 'text.bin')), { timeout: 15000 }).toBe(true);
    expect(fs.readdirSync(landed)).toEqual(['atmosphere']);
  } finally {
    fs.rmSync(landed, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
