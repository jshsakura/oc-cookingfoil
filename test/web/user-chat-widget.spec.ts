import { test, expect } from '@playwright/test';

// The floating AI chat on the web page for a signed-in person. The server side (who may call what,
// whose conversations, the limit) is covered in test/unit/chat-user.test.js; here the page runs
// against canned answers from /api/chat.
async function signedIn(page, { chatOn }: { chatOn: boolean }) {
  await page.addInitScript(() => { try { localStorage.setItem('cookingfoil:lang', 'ko'); } catch { /* none */ } });
  await page.route('**/api/inbox**', (route) => route.fulfill({ json: { items: [] } }));
  await page.route('**/auth/me', (route) => route.fulfill({ json: { user: 'alice', kind: 'user', admin: false, csrf: 'csrf-test' } }));
  await page.route('**/pair/api/mine', (route) => route.fulfill({ json: { devices: [], clients: [] } }));
  await page.route('**/pair/api/wishlist**', (route) => route.fulfill({ json: { items: [] } }));
  const posts: { headers: Record<string, string>; body: { message: string } }[] = [];
  await page.route('**/api/chat**', async (route) => {
    const req = route.request();
    if (!chatOn) return route.fulfill({ status: 404, json: { error: 'the chat is off' } });
    const url = new URL(req.url());
    if (req.method() === 'GET' && url.searchParams.has('status')) return route.fulfill({ json: { configured: true, name: '' } });
    if (req.method() === 'GET') return route.fulfill({ json: { configured: true, name: '', window: 128000, conversations: [], pending: [] } });
    posts.push({ headers: req.headers(), body: req.postDataJSON() });
    const lines = [
      { type: 'tool_start', name: 'retro', action: 'retro_cover_set', conversation: 'c1' },
      { type: 'tool_end', status: 'requested', conversation: 'c1' },
      { type: 'approval', id: 'r1', status: 'requested', kind: 'change', action: 'retro_cover_set', preview: { changes: 'x' }, conversation: 'c1' },
      { type: 'text', delta: '관리자에게 **전달**했습니다.', conversation: 'c1' },
      { type: 'done', conversation: 'c1' },
      { type: 'context', used: 64000, window: 128000, conversation: 'c1' },
    ].map((e) => JSON.stringify(e)).join('\n') + '\n';
    return route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: lines });
  });
  return posts;
}

test('a signed-in person sees the chat button at the lower right, opens it, and a change they ask for waits for an admin', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const posts = await signedIn(page, { chatOn: true });
  await page.goto('/');
  const launch = page.locator('#ch-launch');
  await expect(launch).toBeVisible();
  const box = await launch.boundingBox();
  const vp = page.viewportSize()!;
  expect(box!.x + box!.width).toBeGreaterThan(vp.width - 40);
  expect(box!.y + box!.height).toBeGreaterThan(vp.height - 40);

  await launch.click();
  await expect(page.locator('#ch-widget')).toBeVisible();
  await expect(page.locator('#ch-widget .ch-hello h3')).toHaveText('안녕하세요, 제 이름은 버터입니다. 당신의 게임 생활을 돕기 위해 여러 가지 일을 도울 수 있습니다.');
  await expect(page.locator('#ch-name')).toHaveText('버터');
  await expect(page.locator('#ch-gear')).toHaveCount(0);
  await expect(page.locator('#ch-text')).toHaveAttribute('maxlength', '4000');

  await page.locator('#ch-text').fill('표지를 바꿔 주세요');
  await page.keyboard.press('Enter');
  await expect(page.locator('#ch-widget .ch-msg.me')).toHaveText('표지를 바꿔 주세요');
  await expect(page.locator('#ch-widget .ch-msg:not(.me) strong')).toHaveText('전달');
  await expect(page.locator('#ch-pending-list .ch-card-ask')).toContainText('관리자에게 전달했습니다. 승인되면 변경이 완료됩니다.');
  await expect(page.locator('#ch-pending-list button')).toHaveCount(0);
  await expect(page.locator('#ch-ctx')).toBeVisible();
  await expect(page.locator('#ch-ctx')).toHaveAttribute('aria-label', /50%/);
  expect(posts[0].body.message).toBe('표지를 바꿔 주세요');
  expect(posts[0].headers['x-csrf-token']).toBe('csrf-test');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('the chat button stays hidden while the chat is off', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await signedIn(page, { chatOn: false });
  const asked = page.waitForResponse((r) => r.url().includes('/api/chat?status=1'));
  await page.goto('/');
  expect((await asked).status()).toBe(404);
  await expect(page.locator('#ch-launch')).toBeHidden();
  await expect(page.locator('#ch-widget')).toBeHidden();
  expect(errors).toEqual([]);
});

test('three dots show while the model has not written yet, and go as soon as text arrives', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await signedIn(page, { chatOn: true });
  let release!: () => void;
  const held = new Promise<void>((r) => { release = r; });
  await page.route('**/api/chat', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    await held;
    const lines = [{ type: 'text', delta: '찾았습니다.', conversation: 'c2' }, { type: 'done', conversation: 'c2' }].map((e) => JSON.stringify(e)).join('\n') + '\n';
    return route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: lines });
  });
  await page.goto('/');
  await page.locator('#ch-launch').click();
  await page.locator('#ch-text').fill('마리오 있나요?');
  await page.keyboard.press('Enter');
  const dots = page.locator('#ch-widget .ch-typing');
  await expect(dots).toBeVisible();
  await expect(dots).toHaveAttribute('role', 'status');
  await expect(dots).toHaveAttribute('aria-label', '답을 쓰는 중입니다');
  await expect(dots.locator('i')).toHaveCount(3);
  expect(await dots.locator('i').first().evaluate((e) => getComputedStyle(e).animationName)).toBe('ch-dot');
  release();
  await expect(page.locator('#ch-widget .ch-msg:not(.me)').last()).toHaveText('찾았습니다.');
  await expect(dots).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('with reduced motion the dots stand still', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await signedIn(page, { chatOn: true });
  await page.route('**/api/chat', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    await new Promise(() => {});
  });
  await page.goto('/');
  await page.locator('#ch-launch').click();
  await page.locator('#ch-text').fill('hi');
  await page.keyboard.press('Enter');
  const dot = page.locator('#ch-widget .ch-typing i').first();
  await expect(dot).toBeVisible();
  expect(await dot.evaluate((e) => getComputedStyle(e).animationName)).toBe('none');
  await page.locator('#ch-go').click();
  await expect(page.locator('#ch-widget .ch-typing')).toHaveCount(0);
});

/** /api/inbox standing in for the real one: records each upload's headers and body and answers like it. */
async function fakeInbox(page, answer?: { status: number; json: object }) {
  const uploads: { headers: Record<string, string>; body: string }[] = [];
  await page.route('**/api/inbox', async (route) => {
    const req = route.request();
    if (req.method() !== 'POST') return route.fallback();
    const body = req.postDataBuffer()!.toString('latin1');
    uploads.push({ headers: req.headers(), body });
    if (answer) return route.fulfill(answer);
    const items = [...body.matchAll(/filename="([^"]+)"[\s\S]*?\r\n\r\n([\s\S]*?)\r\n--/g)].map((m) => ({ name: m[1], size: m[2].length }));
    return route.fulfill({ status: 201, json: { ok: true, id: '20261028-alice-0001', files: items.length, bytes: 0, items } });
  });
  return uploads;
}

test('a person pastes a screenshot and drops a file: both go to the inbox with the CSRF token, and the message names them', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const posts = await signedIn(page, { chatOn: true });
  const uploads = await fakeInbox(page);
  await page.goto('/');
  await page.locator('#ch-launch').click();

  // Text on the clipboard is left to the browser.
  const textPaste = await page.locator('#ch-text').evaluate((el) => {
    const dt = new DataTransfer();
    dt.setData('text/plain', 'hello');
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    return ev.defaultPrevented;
  });
  expect(textPaste).toBe(false);

  await page.locator('#ch-text').evaluate((el) => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array([137, 80, 78, 71])], 'image.png', { type: 'image/png' }));
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await expect(page.locator('#ch-files .ch-file')).toHaveCount(1);
  expect(uploads).toHaveLength(1);
  expect(uploads[0].headers['x-csrf-token']).toBe('csrf-test');
  const pasted = /filename="(paste-\d{8}-\d{6}\.png)"/.exec(uploads[0].body)?.[1];
  expect(pasted, 'a pasted screenshot is named for when it was pasted').toBeTruthy();

  await page.locator('#ch-log').evaluate((el) => {
    const dt = new DataTransfer();
    dt.items.add(new File(['abc'], 'list.csv', { type: 'text/csv' }));
    el.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
    el.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  });
  await expect(page.locator('#ch-files .ch-file')).toHaveCount(2);
  expect(uploads[1].body).toContain('filename="list.csv"');

  // Files alone are enough to send.
  await expect(page.locator('#ch-go')).toBeEnabled();
  await page.locator('#ch-text').focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0].body.message).toBe([
    `📎 첨부 ${pasted} (4 B) inbox/20261028-alice-0001/${pasted}`,
    '📎 첨부 list.csv (3 B) inbox/20261028-alice-0001/list.csv',
  ].join('\n'));
  expect(errors).toEqual([]);
});

test('an upload the inbox refuses says why and attaches nothing', async ({ page }) => {
  await signedIn(page, { chatOn: true });
  await fakeInbox(page, { status: 413, json: { error: '한 번에 올릴 수 있는 크기를 넘었습니다.', code: 'too-big' } });
  await page.goto('/');
  await page.locator('#ch-launch').click();
  await page.locator('#ch-file').setInputFiles({ name: 'big.bin', mimeType: 'application/octet-stream', buffer: Buffer.from('x') });
  await expect(page.locator('#ch-widget .ch-note.ch-err')).toHaveText('파일을 올리지 못했습니다. 한 번에 올릴 수 있는 크기를 넘었습니다.');
  await expect(page.locator('#ch-files .ch-file')).toHaveCount(0);
  await expect(page.locator('#ch-go')).toBeDisabled();
});
