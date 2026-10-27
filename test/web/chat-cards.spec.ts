import { test, expect } from '@playwright/test';
import { signIn } from './admin-sign-in';

const card = { kind: 'switch', id: '0100000000010000', name: 'Test Game', platform: 'Nintendo Switch', size: 3221225472, korean: { patch: true, ui: false }, icon: null, sendable: true };
const stream = (lines: object[]) => lines.map((l) => JSON.stringify(l)).join('\n') + '\n';

test('game cards, the context ring and the waiting phrases', async ({ page }) => {
  await signIn(page);
  await page.request.post('/admin/api/integrations/chat', { data: { baseUrl: 'https://llm.example.com/v1', model: 'm', apiKey: 'sk-test-0000-0000' } });
  await page.request.post('/admin/api/server-settings', { data: { chatEnabled: true } });
  await page.setViewportSize({ width: 1366, height: 800 });
  await page.goto('/admin/chat');

  // The greeting breaks after its first sentence.
  await expect(page.locator('#ch-col .ch-hello .ch-hi')).toContainText('제 이름은');
  await expect(page.locator('#ch-col .ch-hello .ch-sub')).toBeVisible();

  const conversation = 'x'.repeat(22);
  await page.route('**/admin/api/chat', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: 'application/x-ndjson',
      body: stream([
        { type: 'tool_start', id: 'c1', name: 'games', action: 'games_recommend', conversation },
        { type: 'cards', id: 'c1', cards: [card, { ...card, id: '0100000000020000', name: 'Second Game', korean: { patch: false, ui: true } }] },
        { type: 'context', used: 4200, window: 10000, conversation },
        { type: 'text', delta: '이런 게임은 어떠세요?' },
        { type: 'done' },
      ]),
    });
  });
  await page.locator('#ch-text').fill('추천해 줘');
  await page.locator('#ch-go').click();

  // A card shows the name, the system, the size and the Korean marks, all as text.
  const first = page.locator('.ch-gcard').first();
  await expect(first).toContainText('Test Game');
  await expect(first).toContainText('Nintendo Switch · 3.0 GB');
  await expect(first).toContainText('한글 패치');
  await expect(page.locator('.ch-gcard').nth(1)).toContainText('한글 지원');
  // Wide screens put the button beside the card's text, not under it.
  const row = (await first.boundingBox())!;
  const button = (await first.locator('button').boundingBox())!;
  expect(button.x).toBeGreaterThan(row.x + row.width / 2);

  // The context meter is a ring with the percent in the middle.
  await expect(page.locator('#ch-ctx')).toHaveText('42%');
  expect(await page.locator('#ch-ctx').evaluate((e) => getComputedStyle(e).borderRadius)).toBe('50%');

  // With no console the button says so and sends nothing.
  let posted = 0;
  await page.route('**/admin/api/chat/send', (route) => { posted++; return route.abort(); });
  await page.route('**/admin/api/chat/consoles', (route) => route.fulfill({ json: { consoles: [] } }));
  await first.locator('button').click();
  await expect(page.locator('#toast')).toContainText('내 기기가 없습니다');
  expect(posted).toBe(0);

  // While the model has not answered, a phrase from the set for what is running stands beside the dots.
  await page.unroute('**/admin/api/chat');
  await page.route('**/admin/api/chat', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    await new Promise((r) => setTimeout(r, 4000));
    await route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: stream([{ type: 'done' }]) });
  });
  await page.locator('#ch-text').fill('또 추천해 줘');
  await page.locator('#ch-go').click();
  const think = ['생각하는 중입니다', '내용을 살펴보는 중입니다', '답을 정리하고 있습니다', '조금만 기다려 주세요', '좋은 답을 고르는 중입니다'];
  const phrase = (await page.locator('.ch-typing .ch-wait').textContent())!;
  expect(think).toContain(phrase);
});
