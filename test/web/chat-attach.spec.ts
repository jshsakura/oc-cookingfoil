import { test, expect } from '@playwright/test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { signIn } from './admin-sign-in';

// The admin attaches a file on the chat page against the real server: it lands in the share inbox,
// and the model (a stand-in that records what it is sent) gets only the line naming it.
const MARKER = 'FILE-BODY-MARKER-0000';

function fakeModel() {
  const asked: any[] = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      asked.push(JSON.parse(raw || '{}'));
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: '받았습니다.' }, finish_reason: null }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 2 } })}\n\n`);
      res.end('data: [DONE]\n\n');
    });
  });
  return { asked, server };
}

test('the admin attaches a file: it goes into the inbox first, and the model sees only its name, size and place', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const { asked, server } = fakeModel();
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as AddressInfo).port;
  await signIn(page);
  let entry = '';
  try {
    expect((await page.request.post('/admin/api/integrations/chat', { data: { baseUrl: `http://127.0.0.1:${port}/v1`, model: 'test-model', apiKey: 'sk-test-0000-0000' } })).ok()).toBe(true);
    expect((await page.request.post('/admin/api/server-settings', { data: { chatEnabled: true } })).ok()).toBe(true);
    await page.goto('/admin/chat');
    await expect(page.locator('#ch-dock')).toBeVisible();
    await expect(page.locator('#ch-clip')).toHaveAttribute('aria-label', '파일 첨부');

    // The upload is held so its progress row and the disabled send button can be seen.
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    await page.route('**/admin/api/chat/attach', async (route) => { await held; await route.continue(); });
    await page.locator('#ch-text').fill('이 메모를 봐 주세요');
    await page.locator('#ch-file').setInputFiles({ name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from(MARKER) });
    await expect(page.locator('#ch-up')).toBeVisible();
    await expect(page.locator('#ch-up-txt')).toContainText('파일을 올리는 중입니다');
    await expect(page.locator('#ch-go')).toBeDisabled();
    release();
    await expect(page.locator('#ch-up')).toBeHidden();
    await expect(page.locator('#ch-files .ch-file')).toHaveText(/note\.txt · 21 B/);
    await expect(page.locator('#ch-go')).toBeEnabled();

    const list = await (await page.request.get('/admin/api/inbox?show=all')).json();
    const got = list.entries.find((e) => e.files.some((f) => f.name === 'note.txt'));
    expect(got, 'the file is in the inbox before anything is sent').toBeTruthy();
    entry = got.id;
    expect(asked).toHaveLength(0);

    await page.keyboard.press('Enter');
    await expect(page.locator('#ch-col .ch-msg:not(.me)').last()).toHaveText('받았습니다.');
    await expect(page.locator('#ch-files .ch-file')).toHaveCount(0);
    const user = asked.at(-1).messages.filter((m) => m.role === 'user').at(-1).content;
    expect(user).toBe(`📎 첨부 note.txt (21 B) inbox/${entry}/note.txt\n이 메모를 봐 주세요`);
    expect(JSON.stringify(asked)).not.toContain(MARKER);
    await expect(page.locator('#ch-col .ch-msg.me')).toContainText(`inbox/${entry}/note.txt`);
    expect(errors).toEqual([]);
  } finally {
    if (entry) await page.request.delete(`/admin/api/inbox/${entry}`);
    await page.request.post('/admin/api/server-settings', { data: { chatEnabled: false } });
    await page.request.post('/admin/api/integrations/chat/clear');
    server.close();
  }
});
