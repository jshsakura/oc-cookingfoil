import { test, expect, type Page } from '@playwright/test';
import { signIn } from './admin-sign-in';
import fs from 'node:fs';

// The activity menu in the admin header: live over /admin/ws, a sync shows up
// and ends in the recent list, a running job draws a bar, and the page falls
// back to polling when the socket is refused.

test('a sync started from the settings tab ends in the activity menu', async ({ page }) => {
  await signIn(page);
  const btn = page.getByRole('button', { name: /서버 활동/ });
  await btn.click();
  const pop = page.getByRole('dialog', { name: '서버 활동' });
  await expect(pop).toBeVisible();
  await expect(pop.locator('#act-live')).toHaveText('실시간');

  await page.request.post('/admin/api/server-settings/sync-now', { data: {}, headers: { Origin: new URL(page.url()).origin } });
  const row = pop.locator('#act-recent .act-row', { hasText: '모든 폴더를 다시 읽습니다' }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row).toHaveClass(/done/);
  await expect(row.locator('.d')).toHaveText('5곳');
  // Each folder of the sync is its own job too.
  await expect(pop.locator('#act-recent .act-row', { hasText: '세이브 폴더를 읽습니다' }).first()).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(pop).toBeHidden();
});

test('a running job draws its bar and count; the menu reads the API while the socket is down', async ({ page }) => {
  const started = Date.now() - 65_000;
  const snap = {
    running: [
      { id: 'a1', kind: 'nsz', title: 'NSZ 로 변환합니다', detail: 'Test Game.nsp', current: 3 * 2 ** 30, total: 6 * 2 ** 30, startedAt: started, state: 'running' },
      { id: 'a2', kind: 'titledb', title: 'titledb 를 받습니다', detail: 'KR.ko', current: 0, total: null, startedAt: started, state: 'running' },
    ],
    recent: [
      { id: 'a0', kind: 'backup', title: 'DB 를 백업합니다', state: 'failed', error: '디스크가 가득 찼습니다', startedAt: started - 5000, endedAt: Date.now() - 30_000, ms: 1200 },
    ],
  };
  await page.routeWebSocket(/\/admin\/ws$/, (ws) => ws.close({ code: 1011 }));
  await page.route('**/admin/api/activity', (route) => route.fulfill({ json: snap }));
  await signIn(page);

  const btn = page.getByRole('button', { name: /서버 활동/ });
  await expect(btn).toHaveClass(/busy/);
  await expect(page.locator('#act-count')).toHaveText('2');
  await btn.click();
  const pop = page.getByRole('dialog', { name: '서버 활동' });
  await expect(pop.locator('#act-live')).toHaveText('15초마다 확인합니다');

  const nsz = pop.locator('#act-running .act-row', { hasText: 'NSZ 로 변환합니다' });
  await expect(nsz.locator('.n')).toContainText('50% · 3.0 GB / 6.0 GB');
  await expect(nsz.locator('.d')).toHaveText('Test Game.nsp');
  await expect(nsz.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
  const tdb = pop.locator('#act-running .act-row', { hasText: 'titledb' });
  await expect(tdb.locator('.act-bar')).toHaveClass(/ind/);
  await expect(tdb.locator('.n')).toContainText('1분');

  const failed = pop.locator('#act-recent .act-row.failed');
  await expect(failed.locator('.d')).toHaveText('디스크가 가득 찼습니다');
  await expect(pop.locator('#act-idle')).toBeHidden();

  fs.mkdirSync('out/web', { recursive: true });
  await pop.screenshot({ path: 'out/web/admin-activity.png' });
  await page.keyboard.press('Escape');
});

test('a job that can be stopped gets a stop button that asks first, then posts the cancel', async ({ page }) => {
  const started = Date.now() - 5000;
  const job = { id: 'a7', kind: 'verify', title: '게임 파일을 검사합니다', detail: 'Test Game.nsp', current: 1, total: 4, startedAt: started, state: 'running', cancellable: true };
  const other = { id: 'a8', kind: 'titledb', title: 'titledb 를 받습니다', detail: null, current: 0, total: null, startedAt: started, state: 'running', cancellable: false };
  const posted: string[] = [];
  await page.routeWebSocket(/\/admin\/ws$/, (ws) => ws.close({ code: 1011 }));
  await page.route('**/admin/api/activity', (route) => route.fulfill({ json: { running: [job, other], recent: [] } }));
  await page.route('**/admin/api/activity/*/cancel', (route) => {
    posted.push(new URL(route.request().url()).pathname);
    return route.fulfill({ json: { ok: true } });
  });
  await signIn(page);
  await page.getByRole('button', { name: /서버 활동/ }).click();
  const pop = page.getByRole('dialog', { name: '서버 활동' });
  const row = pop.locator('#act-running .act-row', { hasText: '게임 파일을 검사합니다' });
  await expect(pop.locator('#act-running .act-row', { hasText: 'titledb' }).getByRole('button', { name: '중지' })).toHaveCount(0);

  await row.getByRole('button', { name: '중지' }).click();
  await expect(page.locator('#ask-text')).toHaveText('이 작업을 중지할까요?');
  await page.locator('#ask-no').click();
  expect(posted).toEqual([]);

  if (await pop.isHidden()) await page.getByRole('button', { name: /서버 활동/ }).click();
  await row.getByRole('button', { name: '중지' }).click();
  await page.locator('#ask-ok').click();
  await expect.poll(() => posted).toEqual(['/admin/api/activity/a7/cancel']);
});

test('the stop button takes every press while live updates arrive', async ({ page }) => {
  // A row taken out of the page between press and release loses the click: with frames every
  // 200 ms, a re-drawn list let only about one press in five through.
  const started = Date.now() - 5000;
  let n = 0;
  const job = () => ({ id: 'a9', kind: 'nsz', title: 'NSZ 로 변환합니다', detail: 'Test Game.nsp', current: ++n * 1e6, total: 6e9, startedAt: started, state: 'running', cancellable: true });
  await page.routeWebSocket(/\/admin\/ws$/, (ws) => {
    const t = setInterval(() => { try { ws.send(JSON.stringify({ type: 'activity', running: [job()], recent: [] })); } catch { clearInterval(t); } }, 200);
  });
  await signIn(page);
  await page.getByRole('button', { name: /서버 활동/ }).click();
  const stop = page.locator('#act-running .act-row').getByRole('button', { name: '중지' });
  await expect(stop).toBeVisible();
  for (let i = 0; i < 5; i++) {
    const box = (await stop.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(250);
    await page.mouse.up();
    await expect(page.locator('#ask-text')).toHaveText('이 작업을 중지할까요?');
    await page.locator('#ask-no').click();
    if (await page.locator('#act-pop').isHidden()) await page.getByRole('button', { name: /서버 활동/ }).click();
  }
});
