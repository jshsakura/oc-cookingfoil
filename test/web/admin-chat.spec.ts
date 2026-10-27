import { test, expect } from '@playwright/test';
import { signIn } from './admin-sign-in';

test('the chat page opens, needs its model before it turns on, and shows a streamed answer and a waiting approval', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await signIn(page);
  await page.goto('/admin/chat');
  await expect(page.locator('a.adm-item[href="/admin/chat"]').first()).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#ch-switch')).toHaveText('채팅 켜기');
  await expect(page.locator('#ch-setup')).toHaveAttribute('open', '');

  // Without a model the switch refuses and says why.
  await page.locator('#ch-switch').click();
  await expect(page.locator('#toast')).toContainText('모델 설정을 먼저');

  await page.locator('#ch-url').fill('https://llm.example.com/v1');
  await page.locator('#ch-model').fill('test-model');
  await page.locator('#ch-key').fill('sk-test-0000-0000');
  await page.locator('#ch-form button[type=submit]').click();
  await expect(page.locator('#ch-keystate')).toContainText('저장된 키가 있습니다');
  await expect(page.locator('#ch-key')).toHaveValue('');
  await expect(page.content()).resolves.not.toContain('sk-test-0000-0000');

  await page.locator('#ch-switch').click();
  await expect(page.locator('#ch-main')).toBeVisible();
  await expect(page.locator('#ch-switch')).toHaveText('채팅 끄기');

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
  await page.locator('#ch-go').click();
  await expect(page.locator('#ch-log .ch-msg').last()).toContainText('안녕하세요');
  const last = page.locator('#ch-log .ch-msg').last();
  await expect(last.locator('strong')).toHaveText('굵게');
  await expect(last.locator('code')).toHaveText('코드');
  await expect(last.locator('li')).toHaveCount(2);
  await expect(last.locator('pre')).toHaveText('A\nB');
  await expect(last).not.toContainText('**');
  await expect(last.locator('b')).toHaveCount(1); // only the speaker label; the model's tag stayed text
  await expect(last).toContainText('<b>태그</b>');
  await expect(page.locator('#ch-pending-list .ch-card')).toContainText('would restart');
  await expect(page.locator('#ch-pending')).toContainText('다시 시작하면');

  // Turn it off again so the run leaves the server as it found it.
  await page.locator('#ch-switch').click();
  await expect(page.locator('#ch-off')).toBeVisible();
  expect(errors).toEqual([]);
});
