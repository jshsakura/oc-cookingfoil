import { test, expect, type Page } from '@playwright/test';
import { generate } from 'otplib';
import fs from 'node:fs';

// The admin page's 변환 tab: off by default, turned on from its settings, a
// library check queues a big enough .nsp, and the row actions work.
const SECRET = 'KRSXG5CTMVRXEZLUKRSXG5CTMVRXEZLU';
const GAMES = '/tmp/cookingfoil-web-test-games';
const FILE = 'Queue Game [0100000000030000][v0].nsp';

async function signIn(page: Page) {
  await page.goto('/admin?enrolled=1');
  await page.getByLabel('인증 앱 코드').fill(await generate({ secret: SECRET }));
  await page.getByRole('button', { name: '들어가기', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'CookingFoil 관리', exact: true })).toBeVisible();
}

test.afterEach(async ({ page }) => {
  fs.rmSync(`${GAMES}/${FILE}`, { force: true });
  await page.request.post('/admin/api/server-settings', { data: { nszEnabled: null, nszMinSizeMb: null } }).catch(() => {});
  const d = await (await page.request.get('/admin/api/nsz')).json().catch(() => ({ items: [] }));
  for (const i of d.items ?? []) await page.request.delete(`/admin/api/nsz/items/${i.id}`).catch(() => {});
});

test('the conversion queue is off by default, turns on from its settings and queues a library file', async ({ page }) => {
  page.on('dialog', (dialog) => dialog.accept());
  await signIn(page);
  await page.getByRole('link', { name: '변환' }).click();
  await expect(page.locator('#nz-state')).toHaveText('꺼짐');
  await expect(page.locator('#nz-toggle')).toBeDisabled();
  await expect(page.locator('#nz-cards .card')).toHaveCount(5);
  await expect(page.locator('#nz-settings')).toContainText('블록 압축');
  await expect(page.locator('.ss-row[data-key="nszXci"]')).toContainText('기기에서 확인하지 않았으니');
  await expect(page.locator('.ss-row[data-key="nszWorkers"]')).toContainText('내려받기가 느려집니다');

  await page.locator('.ss-row[data-key="nszEnabled"] .ss-switch').click();
  await expect(page.locator('#nz-state')).toHaveText('일시정지');
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
