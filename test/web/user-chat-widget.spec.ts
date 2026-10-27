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
