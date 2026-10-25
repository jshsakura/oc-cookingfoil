import { test, expect, type Page } from '@playwright/test';
import { signIn } from './admin-sign-in';
import fs from 'node:fs';
import { acceptAsks } from './ask';
import { reveal } from './fold';

// The admin page's 변환 tab: off by default, turned on from its settings, a
// library check queues a big enough .nsp, and the row actions work.
const GAMES = process.env.COOK_GAMES_DIR!;
const FILE = 'Queue Game [0100000000030000][v0].nsp';


test.afterEach(async ({ page }) => {
  fs.rmSync(`${GAMES}/${FILE}`, { force: true });
  await page.request.post('/admin/api/server-settings', { data: { nszEnabled: null, nszMinSizeMb: null } }).catch(() => {});
  const d = await (await page.request.get('/admin/api/nsz')).json().catch(() => ({ items: [] }));
  for (const i of d.items ?? []) await page.request.delete(`/admin/api/nsz/items/${i.id}`).catch(() => {});
});

test('the conversion queue is off by default, turns on from its settings and queues a library file', async ({ page }) => {
  await acceptAsks(page);
  await signIn(page);
  await page.goto("/admin/games");
  await page.goto('/admin/convert');
  await expect(page.locator('#nz-state')).toHaveText('꺼짐');
  await expect(page.locator('#nz-toggle')).toBeDisabled();
  await expect(page.locator('#nz-cards .card')).toHaveCount(5);
  await expect(page.locator('#nz-settings')).toContainText('블록 압축');
  await expect(page.locator('.ss-row[data-key="nszXci"]')).toContainText('XCI 파일도 XCZ 로 압축합니다');
  await expect(page.locator('.ss-row[data-key="nszWorkers"]')).toContainText('다운로드하는 콘솔이 느려집니다');

  await (await reveal(page.locator('.ss-row[data-key="nszEnabled"] .ss-switch'))).click();
  await expect(page.locator('#nz-state')).toHaveText('쉬는 중');
  await expect(page.locator('#nz-toggle')).toBeEnabled();
  const min = page.locator('.ss-row[data-key="nszMinSizeMb"] input');
  await min.fill('1');
  await min.press('Tab');
  await expect(page.locator('.ss-row[data-key="nszMinSizeMb"]')).toContainText('여기서 정한 값입니다');

  fs.writeFileSync(`${GAMES}/${FILE}`, Buffer.alloc(2 * 1024 * 1024));
  await page.getByRole('button', { name: '라이브러리 검사', exact: true }).click();
  await expect(page.locator('#toast')).toContainText('1개');
  const row = page.locator('#nz-list .nz-row', { hasText: FILE });
  await expect(row).toContainText('대기');
  await expect(row).toContainText('2.0 MB');
  await expect(page.locator('#nz-cards')).toContainText('대기');
  fs.mkdirSync('out/web', { recursive: true });
  await page.locator('#tab-nsz').screenshot({ path: 'out/web/admin-nsz.png' });

  await page.locator('#nz-filter').getByRole('button', { name: '완료', exact: true }).click();
  await expect(page.locator('#nz-list')).toContainText('이 상태의 파일이 없습니다');
  await page.locator('#nz-filter').getByRole('button', { name: '전체', exact: true }).click();
  await row.getByRole('button', { name: '빼기', exact: true }).click();
  await expect(page.locator('#toast')).toContainText('대기열에서 뺐습니다');
  await expect(page.locator('#nz-list')).toContainText('대기열이 비어 있습니다');
});

test('the queue tab fits a phone screen without sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await signIn(page);
  await page.goto('/admin#nsz');
  await expect(page.locator('#nz-state')).toHaveText('꺼짐');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  fs.mkdirSync('out/web', { recursive: true });
  await page.screenshot({ path: 'out/web/admin-nsz-phone.png', fullPage: true });
});

// The queue's answers are stood in for here: a real conversion needs nsz and minutes.
const row = (id: string, rel: string, state: string, extra = {}) => ({ id, rel, kind: 'nsp', size: 4 * 1024 ** 3, name: null, titleId: null, state, addedAt: 1, ...extra });

test('two waiting rows run by themselves, a kept row says when its original goes, no 되돌리기, and the log lists entries', async ({ page }) => {
  await acceptAsks(page);
  const now = Date.now();
  const items = [
    row('aaaaaaaaaaa1', 'One [0100000000040000][v0].nsp', 'waiting'),
    row('aaaaaaaaaaa2', 'Two [0100000000050000][v0].nsp', 'waiting'),
    row('aaaaaaaaaaa3', 'Three [0100000000060000][v0].nsp', 'waiting'),
    row('aaaaaaaaaaa4', 'Kept [0100000000070000][v0].nsp', 'done', { outSize: 3 * 1024 ** 3, savedBytes: 1024 ** 3, keptAt: now, keptBytes: 4 * 1024 ** 3, keepUntil: now + 5 * 3600_000 + 30_000 }),
  ];
  let sent: unknown = null;
  await page.route(/\/admin\/api\/nsz\?/, async (route) => {
    const real = await (await route.fetch()).json();
    await route.fulfill({ json: { ...real, enabled: true, status: 'idle', items, total: items.length, offset: 0, limit: 50, totals: { ...real.totals, waiting: 3, busy: 0 },
      kept: { count: 1, bytes: 4 * 1024 ** 3, capBytes: 0, keepHours: 6, nextAt: now + 5 * 3600_000 + 30_000, now } } });
  });
  let filterRun: unknown = null;
  await page.route('**/admin/api/nsz/run-filter', async (route) => { filterRun = route.request().postDataJSON(); await route.fulfill({ json: { ok: true, count: 3 } }); });
  await page.route('**/admin/api/nsz/run-selected', async (route) => { sent = route.request().postDataJSON(); await route.fulfill({ json: { ok: true, count: 2 } }); });
  await page.route(/\/admin\/api\/nsz\/log/, (route) => route.fulfill({ json: { offset: 0, limit: 50, total: 2, items: [
    { at: now, id: 'aaaaaaaaaaa4', rel: 'Kept [0100000000070000][v0].nsp', name: 'Kept Game', from: 'Kept [0100000000070000][v0].nsp', to: 'Kept [0100000000070000][v0].nsz', sizeBefore: 4 * 1024 ** 3, sizeAfter: 3 * 1024 ** 3, event: 'converted' },
    { at: now - 1000, id: 'aaaaaaaaaaa5', rel: 'Old.nsp', name: 'Old Game', from: 'Old.nsp', to: 'Old.nsz', sizeBefore: 1024 ** 3, sizeAfter: null, event: 'restored' },
  ] } }));
  await signIn(page);
  await page.goto('/admin#nsz');

  const runSel = page.locator('#nz-run-sel');
  await expect(runSel).toBeDisabled();
  await expect(runSel).toHaveText('변환할 파일을 고릅니다');
  await page.getByRole('checkbox', { name: /^One .* 선택$/ }).check();
  await page.getByRole('checkbox', { name: /^Three .* 선택$/ }).check();
  await expect(runSel).toHaveText('선택한 2개 변환');
  await runSel.click();
  await expect(page.locator('#toast')).toContainText('선택한 2개를 변환합니다');
  expect(sent).toEqual({ ids: ['aaaaaaaaaaa1', 'aaaaaaaaaaa3'] });

  // With nothing ticked, the 대기 tab runs every file waiting now.
  await page.locator('#nz-filter [data-filter="waiting"]').click();
  await expect(runSel).toHaveText('대기 3개 모두 변환');
  await runSel.click();
  await expect(page.locator('#toast')).toContainText('대기 중인 3개를 변환합니다');
  expect(filterRun).toEqual({ filter: 'waiting' });
  await page.locator('#nz-filter [data-filter="all"]').click();
  await page.locator('#nz-pick-all').check();
  await expect(runSel).toHaveText('선택한 3개 변환');

  const kept = page.locator('#nz-list .nz-row', { hasText: 'Kept' });
  await expect(kept).toContainText('원본 보관 중 · 5시간 1분 뒤 휴지통으로');
  await expect(page.locator('#nz-kept')).toContainText('보관 중인 원본 1개 · 4.0 GB');
  await expect(page.locator('#nz-purge')).toBeVisible();
  fs.mkdirSync('out/web', { recursive: true });
  await page.locator('#tab-nsz').screenshot({ path: 'out/web/admin-nsz-kept.png' });
  await expect(kept.getByRole('button', { name: '되돌리기' })).toHaveCount(0);

  const log = page.locator('#nz-log');
  await expect(log).toContainText('Kept Game');
  await expect(log).toContainText('-25%');
  // A line from the old 되돌리기 still renders, as its plain event name.
  await expect(log.locator('.nz-row', { hasText: 'Old Game' })).toContainText('되돌림');
});
