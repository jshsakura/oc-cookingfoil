import { test, expect, type Page } from '@playwright/test';

// IGDB trailers in a game's window, for admins only: YouTube's thumbnail with a play mark,
// which becomes YouTube's player only when clicked. All data is mocked; nothing goes to YouTube.
const game = [
  { url: '../A%2FGame%20%5B0100000000010000%5D%5Bv0%5D.nsp', name: 'Test Game', size: 8e9, app_type: 'base', added_at: 1, title_id: '0100000000010000', base_title_id: '0100000000010000', app_version: 0, languages: ['ko'], install_size: 9e9 },
];
const VIDEOS = [{ id: 'dQw4w9WgXcQ', name: 'Launch Trailer' }, { id: 'a-b_c1234XY', name: '' }];

async function setUp(page: Page, me: object, videos = VIDEOS) {
  await page.addInitScript(() => { try { localStorage.setItem('cookingfoil:lang', 'ko'); } catch { /* none */ } });
  // Thumbnails and the player stay in the test: answered here, never fetched from YouTube.
  await page.route('https://i.ytimg.com/**', (route) => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360"/>' }));
  await page.route('https://www.youtube-nocookie.com/**', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>player</title>' }));
  await page.route('**/auth/me', (route) => route.fulfill({ json: me }));
  // Signed in with a mocked account: the inbox would answer the real server's 401 and send the page to /login.
  await page.route('**/api/inbox', (route) => route.fulfill({ json: { enabled: false } }));
  await page.route('**/api/shop/sections', (route) => route.fulfill({ json: { sections: [{ id: 'all', title: 'All', items: game }], genres: {} } }));
  await page.route('**/api/art/0100000000010000', (route) => route.fulfill({ json: { icon: false, banner: false, screens: [], originals: {} } }));
  const asked: string[] = [];
  await page.route('**/api/videos/**', (route) => { asked.push(new URL(route.request().url()).pathname); route.fulfill({ json: { videos } }); });
  return asked;
}

test('an admin sees the trailers as thumbnails and a click puts the player in place', async ({ page }) => {
  const asked = await setUp(page, { user: 'alice', admin: true, csrf: 'x' });
  await page.goto('/');
  await page.locator('#games .game').first().click();
  const box = page.locator('#modal-videos');
  await expect(box).toBeVisible();
  await expect(box.locator('h4')).toHaveText('트레일러');
  expect(asked).toEqual(['/api/videos/title/0100000000010000']);

  const thumbs = box.locator('.video-thumb');
  await expect(thumbs).toHaveCount(2);
  await expect(thumbs.first().locator('img')).toHaveAttribute('src', 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
  await expect(thumbs.first()).toHaveAttribute('aria-label', '트레일러를 재생합니다: Launch Trailer');
  await expect(thumbs.first().locator('.play svg')).toHaveCount(1);
  await expect(box.locator('.video-name')).toHaveText(['Launch Trailer']);
  // No player and no request to YouTube's player until a thumbnail is clicked.
  await expect(box.locator('iframe')).toHaveCount(0);

  await thumbs.first().click();
  const frame = box.locator('iframe');
  await expect(frame).toHaveCount(1);
  await expect(frame).toHaveAttribute('src', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1');
  await expect(frame).toHaveAttribute('allow', /autoplay/);
  await expect(box.locator('.video-thumb')).toHaveCount(1, { timeout: 2000 });
});

test('a regular account never asks for trailers, and a game without any shows no row', async ({ page }) => {
  const asked = await setUp(page, { user: 'bob', admin: false, csrf: 'x' });
  await page.goto('/');
  // The account is known before the window opens.
  await expect(page.locator('#logout-link')).toHaveJSProperty('hidden', false);
  await page.locator('#games .game').first().click();
  await expect(page.locator('#modal')).toHaveClass(/open/);
  await expect(page.locator('#modal-videos')).toBeHidden();
  expect(asked).toEqual([]);
});

test('an empty or malformed list leaves the row hidden', async ({ page }) => {
  await setUp(page, { user: 'alice', admin: true, csrf: 'x' }, [{ id: 'bad', name: 'x' }, { id: '"><img src=x>', name: 'y' }]);
  await page.goto('/');
  await page.locator('#games .game').first().click();
  await expect(page.locator('#modal')).toHaveClass(/open/);
  await expect(page.locator('#modal-videos')).toBeHidden();
  await expect(page.locator('#modal-videos .video-thumb')).toHaveCount(0);
});
