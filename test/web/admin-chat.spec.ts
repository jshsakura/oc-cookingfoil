import { test, expect } from '@playwright/test';
import { signIn } from './admin-sign-in';

async function setUp(page) {
  await page.locator('#ch-url').fill('https://llm.example.com/v1');
  await page.locator('#ch-model').fill('test-model');
  await page.locator('#ch-key').fill('sk-test-0000-0000');
  await page.locator('#ch-form button[type=submit]').click();
  await expect(page.locator('#ch-keystate')).toContainText('저장된 키가 있습니다');
  await expect(page.locator('#ch-key')).toHaveValue('');
  await expect(page.content()).resolves.not.toContain('sk-test-0000-0000');
}

test('the chat is a full-height chat screen: off state, settings sheet, greeting chips, streamed markdown, approvals', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await signIn(page);
  await page.goto('/admin/chat');
  await expect(page.locator('a.adm-item[href="/admin/chat"]').first()).toHaveAttribute('aria-current', 'page');

  // Off: a centered note with a way to the settings, no message box, no accordion or button row.
  await expect(page.locator('#ch-col .ch-hello')).toContainText('채팅이 꺼져 있습니다');
  await expect(page.locator('#ch-dock')).toBeHidden();
  await expect(page.locator('#tab-chat details')).toHaveCount(0);

  // The sheet refuses the switch until a model is set, then takes the model and turns on.
  await page.locator('#ch-col .ch-hello button').click();
  await expect(page.locator('#ch-sheet')).toBeVisible();
  await page.locator('#ch-on').click(); // refused, so it snaps back
  await expect(page.locator('#toast')).toContainText('모델 설정을 먼저');
  await expect(page.locator('#ch-on')).not.toBeChecked();
  await setUp(page);
  await page.locator('#ch-on').check();
  await expect(page.locator('#ch-dock')).toBeVisible();
  await page.locator('#ch-sheet-x').click();
  await expect(page.locator('#ch-sheet')).toBeHidden();

  // Greeting with three example chips; a chip fills the box without sending.
  await expect(page.locator('#ch-col .ch-hello h3')).toBeVisible();
  await expect(page.locator('.ch-chip')).toHaveCount(3);
  await page.locator('.ch-chip').first().click();
  await expect(page.locator('#ch-text')).toHaveValue(/게임이 몇 개/);

  // The page fills the screen: the box sits at the bottom, no resize handle, grows to eight lines.
  const vh = page.viewportSize()!.height;
  const card = await page.locator('#ch-send').boundingBox();
  expect(card!.y + card!.height).toBeGreaterThan(vh - 40);
  expect(await page.locator('#ch-text').evaluate((e) => getComputedStyle(e).resize)).toBe('none');
  await page.locator('#ch-text').fill(Array.from({ length: 20 }, (_, i) => `줄 ${i}`).join('\n'));
  const tall = await page.locator('#ch-text').boundingBox();
  expect(tall!.height).toBeLessThan(8 * 22 + 20);
  expect(tall!.height).toBeGreaterThan(5 * 22);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  await page.route('**/admin/api/chat', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const lines = [
      { type: 'text', delta: '안녕', conversation: 'c' },
      { type: 'text', delta: '하세요 **굵게** 와 `코드` <b>태그</b>\n- 하나\n- 둘\n```\nA\nB\n```', conversation: 'c' },
      { type: 'approval', id: 'p1', status: 'pending', preview: { changes: 'would restart' }, tool: 'admin', action: 'server_restart', conversation: 'c' },
      { type: 'done', conversation: 'c' },
    ].map((e) => JSON.stringify(e)).join('\n') + '\n';
    await route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: lines });
  });
  await page.locator('#ch-text').fill('hi');
  await page.keyboard.press('Enter');
  const mine = page.locator('#ch-col .ch-msg.me');
  await expect(mine).toHaveText('hi');
  const bot = page.locator('#ch-col .ch-msg:not(.me)').last();
  await expect(bot).toContainText('안녕하세요');
  await expect(bot.locator('strong')).toHaveText('굵게');
  await expect(bot.locator('code').first()).toHaveText('코드');
  await expect(bot.locator('li')).toHaveCount(2);
  await expect(bot.locator('pre')).toHaveText('A\nB');
  await expect(bot).toContainText('<b>태그</b>');
  expect(await bot.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  expect(await mine.evaluate((e) => getComputedStyle(e).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
  // One column: the bubble, the box and the top row end on the same right edge, and the answer starts on the left edge.
  const right = async (sel: string) => { const b = await page.locator(sel).first().boundingBox(); return b!.x + b!.width; };
  const left = async (sel: string) => (await page.locator(sel).first().boundingBox())!.x;
  expect(Math.abs((await right('#ch-col .ch-msg.me')) - (await right('#ch-send')))).toBeLessThan(2);
  expect(Math.abs((await right('.ch-top')) - (await right('#ch-send')))).toBeLessThan(2);
  expect(Math.abs((await left('#ch-col .ch-msg:not(.me)')) - (await left('#ch-send')))).toBeLessThan(2);
  // The toast rises above the box instead of covering it.
  await page.evaluate(() => toast('x'));
  const toastBox = await page.locator('#toast').boundingBox();
  const sendBox = await page.locator('#ch-send').boundingBox();
  expect(toastBox!.y + toastBox!.height).toBeLessThanOrEqual(sendBox!.y + 1);
  await expect(page.locator('#ch-pending-list .ch-card-ask')).toContainText('would restart');
  await expect(page.locator('#ch-pending')).toContainText('다시 시작하면');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  // Turn it off again so the run leaves the server as it found it.
  await page.locator('#ch-gear').click();
  await page.locator('#ch-on').uncheck();
  await expect(page.locator('#ch-dock')).toBeHidden();
  expect(errors).toEqual([]);
});

test('on a phone the message box sits at the bottom edge and nothing overflows sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await page.goto('/admin/chat');
  await expect(page.locator('#ch-col .ch-hello')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.locator('#ch-gear').click();
  const sheet = await page.locator('#ch-sheet').boundingBox();
  expect(sheet!.x).toBeGreaterThanOrEqual(0);
  expect(sheet!.x + sheet!.width).toBeLessThanOrEqual(390);
  expect(sheet!.y + sheet!.height).toBeGreaterThan(844 - 4);
});
