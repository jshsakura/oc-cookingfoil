import { test, expect } from '@playwright/test';
import { signIn } from './admin-sign-in';

// The assistant's name and persona are the admin's, set in the chat's settings sheet without a restart.
test('the admin renames the assistant in the settings sheet and the greeting and header follow', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await signIn(page);
  expect((await page.request.post('/admin/api/integrations/chat', { data: { baseUrl: 'https://llm.example.com/v1', model: 'test-model', apiKey: 'sk-test-0000-0000' } })).ok()).toBe(true);
  expect((await page.request.post('/admin/api/server-settings', { data: { chatEnabled: true, chatName: null, chatPersona: null } })).ok()).toBe(true);
  try {
    await page.goto('/admin/chat');
    await expect(page.locator('#ch-name')).toHaveText('버터');
    await expect(page.locator('#ch-col .ch-hello h3')).toHaveText('안녕하세요, 제 이름은 버터입니다. 당신의 게임 생활을 돕기 위해 여러 가지 일을 도울 수 있습니다.');

    await page.locator('#ch-gear').click();
    await expect(page.locator('#ch-window-in')).toHaveValue('128000');
    await page.locator('#ch-name-in').fill('모찌');
    await page.locator('#ch-persona-in').fill('차분한 사서처럼 말합니다.');
    await page.locator('#ch-persona-form button[type=submit]').click();
    await expect(page.locator('#toast')).toContainText('저장했습니다');
    await page.locator('#ch-sheet-x').click();
    await expect(page.locator('#ch-name')).toHaveText('모찌');
    await expect(page.locator('#ch-col .ch-hello h3')).toContainText('제 이름은 모찌입니다');

    const saved = await (await page.request.get('/admin/api/server-settings')).json();
    expect(saved.settings.chatName.value).toBe('모찌');
    expect(saved.settings.chatPersona.value).toBe('차분한 사서처럼 말합니다.');
    expect(errors).toEqual([]);
  } finally {
    await page.request.post('/admin/api/server-settings', { data: { chatEnabled: false, chatName: null, chatPersona: null } });
    await page.request.post('/admin/api/integrations/chat/clear');
  }
});
