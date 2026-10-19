import { test, expect } from '@playwright/test';

// The web account menu registers the RetroAchievements username the same way the console does.
test('the account menu checks, saves and unlinks a RetroAchievements username', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cookingfoil:lang', 'ko'));
  await page.route('**/auth/me', route => route.fulfill({ json: { user: 'Viewer', admin: false, csrf: 'c' } }));
  await page.route('**/api/inbox', route => route.fulfill({ json: { enabled: false } }));
  let saved: string | null = null;
  const sent: string[] = [];
  await page.route('**/api/retro/achievements/account**', async route => {
    const req = route.request();
    const url = new URL(req.url());
    sent.push(`${req.method()} ${url.pathname}${url.search}`);
    if (url.pathname.endsWith('/lookup')) {
      return url.searchParams.get('username')!.toLowerCase() === 'mario'
        ? route.fulfill({ json: { username: 'Mario' } })
        : route.fulfill({ status: 404, json: { error: 'no such RetroAchievements player' } });
    }
    if (req.method() === 'PUT') saved = 'Mario';
    if (req.method() === 'DELETE') saved = null;
    return route.fulfill({ json: { enabled: true, username: saved } });
  });
  await page.goto('/');
  await page.locator('#acct-btn').click();
  const menu = page.locator('#acct-list');
  await expect(menu.getByRole('menuitem', { name: '관리자 대시보드' })).toBeHidden();
  await menu.getByRole('menuitem', { name: '레트로 업적 설정' }).click();

  const dialog = page.locator('#ra-modal');
  await expect(dialog.getByRole('heading', { name: '레트로 업적 설정' })).toBeVisible();
  await expect(dialog).toContainText('원본 롬으로 할 때만');
  await expect(dialog).toContainText('레트로 게임 화면에서 RetroAchievements 에 로그인');
  await expect(dialog.locator('#ra-now')).toHaveText('아직 등록한 아이디가 없습니다.');
  await expect(dialog.locator('#ra-remove')).toBeHidden();

  const name = dialog.locator('#ra-name');
  await name.fill('nobody');
  await dialog.locator('#ra-check').click();
  await expect(dialog.locator('#ra-msg')).toHaveText('RetroAchievements 에 없는 아이디입니다. 철자를 확인합니다.');
  await name.fill('bad name!');
  await dialog.locator('#ra-check').click();
  await expect(dialog.locator('#ra-msg')).toContainText('2~32자');
  await name.fill('mario');
  await dialog.locator('#ra-check').click();
  await expect(dialog.locator('#ra-msg')).toContainText('Mario 아이디가 RetroAchievements 에 있습니다');
  await expect(name).toHaveValue('Mario');

  await dialog.locator('#ra-save').click();
  await expect(dialog.locator('#ra-msg')).toHaveText('Mario 아이디를 등록했습니다.');
  await expect(dialog.locator('#ra-now')).toHaveText('지금 등록된 아이디는 Mario 입니다.');
  await page.setViewportSize({ width: 393, height: 800 });
  const box = (await dialog.locator('.modal').boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(393);
  await dialog.locator('#ra-remove').click();
  await expect(dialog.locator('#ra-msg')).toHaveText('아이디 등록을 해제했습니다.');
  await expect(dialog.locator('#ra-remove')).toBeHidden();
  expect(sent.filter(s => !s.startsWith('GET /api/retro/achievements/account?') && s !== 'GET /api/retro/achievements/account'))
    .toEqual(['GET /api/retro/achievements/account/lookup?username=nobody', 'GET /api/retro/achievements/account/lookup?username=mario',
      'PUT /api/retro/achievements/account', 'DELETE /api/retro/achievements/account']);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveAttribute('aria-hidden', 'true');
});

test('the menu leaves the achievements item out when the server has no RetroAchievements key', async ({ page }) => {
  await page.route('**/auth/me', route => route.fulfill({ json: { user: 'Viewer', admin: true } }));
  await page.route('**/api/retro/achievements/account', route => route.fulfill({ json: { enabled: false, username: null } }));
  await page.route('**/api/inbox', route => route.fulfill({ json: { enabled: false } }));
  await page.addInitScript(() => localStorage.setItem('cookingfoil:lang', 'ko'));
  await page.goto('/');
  await page.locator('#acct-btn').click();
  await expect(page.locator('#acct-list').getByRole('menuitem', { name: '관리자 대시보드' })).toBeVisible();
  await expect(page.locator('#ra-link')).toBeHidden();
});
