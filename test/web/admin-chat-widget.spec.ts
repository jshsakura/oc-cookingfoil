import { test, expect } from '@playwright/test';
import { signIn } from './admin-sign-in';

async function chatOn(page, on: boolean) {
  if (on) {
    const r = await page.request.post('/admin/api/integrations/chat', { data: { baseUrl: 'https://llm.example.com/v1', model: 'test-model', apiKey: 'sk-test-0000-0000' } });
    expect(r.ok()).toBe(true);
  }
  const s = await page.request.post('/admin/api/server-settings', { data: { chatEnabled: on } });
  expect(s.ok()).toBe(true);
  // Off also forgets the model, so the next spec starts from a server with no chat.
  if (!on) expect((await page.request.post('/admin/api/integrations/chat/clear')).ok()).toBe(true);
}

test('the floating chat shows only while the chat is on, opens over any page, and talks like the chat page', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await signIn(page);
  await chatOn(page, false);

  await page.goto('/admin/games');
  await expect(page.locator('#ch-widget')).toBeHidden();
  await expect(page.locator('#ch-launch')).toBeHidden();

  await chatOn(page, true);
  try {
    await page.goto('/admin/users');
    await expect(page.locator('#ch-launch')).toBeVisible();
    const launch = await page.locator('#ch-launch').boundingBox();
    const vp = page.viewportSize()!;
    expect(launch!.x + launch!.width).toBeGreaterThan(vp.width - 40);
    expect(launch!.y + launch!.height).toBeGreaterThan(vp.height - 40);

    await page.route('**/admin/api/chat', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      const lines = [
        { type: 'text', delta: '위젯 **답변**', conversation: 'w' },
        { type: 'done', conversation: 'w' },
      ].map((e) => JSON.stringify(e)).join('\n') + '\n';
      await route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: lines });
    });
    await page.locator('#ch-launch').click();
    await expect(page.locator('#ch-widget')).toBeVisible();
    await expect(page.locator('#ch-widget .ch-hello h3')).toBeVisible();
    await expect(page.locator('#ch-close')).toBeVisible();
    await page.locator('#ch-text').fill('hi');
    await page.keyboard.press('Enter');
    await expect(page.locator('#ch-widget .ch-msg.me')).toHaveText('hi');
    await expect(page.locator('#ch-widget .ch-msg:not(.me) strong')).toHaveText('답변');
    const panel = await page.locator('#ch-widget').boundingBox();
    expect(panel!.x + panel!.width).toBeLessThanOrEqual(vp.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

    // The settings sheet opens from the panel; Escape closes the sheet first and the panel next.
    await page.locator('#ch-gear').click();
    await expect(page.locator('#ch-sheet')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#ch-sheet')).toBeHidden();
    await expect(page.locator('#ch-widget')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#ch-widget')).toBeHidden();
    await page.locator('#ch-launch').click();
    await page.locator('#ch-close').click();
    await expect(page.locator('#ch-widget')).toBeHidden();

    // It is not offered on the chat's own page.
    await page.goto('/admin/chat');
    await expect(page.locator('#ch-launch')).toHaveCount(0);
    await expect(page.locator('#tab-chat')).toBeVisible();
  } finally {
    await chatOn(page, false);
  }
  expect(errors).toEqual([]);
});

test('on a phone the panel takes the whole screen and the launcher steps aside', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await chatOn(page, true);
  try {
    await page.goto('/admin/games');
    // The page ends below the floating button, so its last row can be scrolled clear of it.
    const pad = await page.locator('.wrap').evaluate((e) => parseFloat(getComputedStyle(e).paddingBottom));
    const btn = await page.locator('#ch-launch').boundingBox();
    expect(pad).toBeGreaterThanOrEqual(844 - btn!.y);
    await page.locator('#ch-launch').click();
    const panel = await page.locator('#ch-widget').boundingBox();
    expect([panel!.x, panel!.y, panel!.width, panel!.height]).toEqual([0, 0, 390, 844]);
    await expect(page.locator('#ch-launch')).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.locator('#ch-close').click();
    await expect(page.locator('#ch-launch')).toBeVisible();
  } finally {
    await chatOn(page, false);
  }
});
