import { test, expect } from '@playwright/test';
import { signIn } from './admin-sign-in';

// 메타데이터: one job a page, the kind of item chosen with a filter over it. The web server's library
// (test/web/server.mjs) holds one game, Test Game, with no Korean name.

const GAME = '0100000000010000';

// A name left by a failed run would rename Test Game for every spec after it.
test.afterEach(async ({ page }) => {
  await page.request.post(`/admin/api/descriptions/${GAME}/reset`, { data: { field: 'name' } }).catch(() => {});
});

test('검토 필요 lists the game without a Korean name and leads to its title editor', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await signIn(page);
  await page.goto('/admin/metadata/review');
  await expect(page.locator('#adm-crumb')).toContainText('검토 필요');
  await expect(page.locator('#mt-kind [data-kind="game"]')).toHaveAttribute('aria-pressed', 'true');
  const row = page.locator('#mt-review .mt-row', { hasText: 'Test Game' });
  await expect(row).toContainText('한국어 이름 없음');
  await expect(page.locator('#mt-kind [data-kind="game"] .count')).not.toBeHidden();

  await page.locator('#mt-kind [data-kind="retro"]').click();
  await expect(page).toHaveURL(/kind=retro/);
  await expect(page.locator('#mt-review .mt-card, #mt-review p.muted').first()).toBeVisible();

  await page.locator('#mt-kind [data-kind="game"]').click();
  await row.click();
  await expect(page).toHaveURL(new RegExp(`/admin/metadata/titles\\?kind=game&id=${GAME}`));
  await expect(page.locator('#mt-editor')).toBeVisible();
  expect(errors).toEqual([]);
});

test('제목 saves a game\'s Korean name, and saving it empty gives the original back', async ({ page }) => {
  await signIn(page);
  await page.goto(`/admin/metadata/titles?kind=game&id=${GAME}`);
  await expect(page.locator('#mt-editor')).toBeVisible();
  await page.locator('#mt-ko').fill('테스트 게임');
  await page.locator('#mt-form button[type=submit]').click();
  await expect(page.locator('#toast')).toContainText('이름을 저장했습니다');
  const own = await page.request.get(`/admin/api/descriptions/${GAME}`).then((r) => r.json());
  expect(own.own?.name?.ko).toBe('테스트 게임');
  await expect(page.locator('#mt-items .mt-item[aria-selected="true"]')).toContainText('테스트 게임');
  await expect(page.locator('#mt-name')).toHaveText('테스트 게임');

  await page.locator('#mt-ko').fill('');
  await page.locator('#mt-form button[type=submit]').click();
  await expect.poll(async () => (await page.request.get(`/admin/api/descriptions/${GAME}`).then((r) => r.json())).own?.name?.ko ?? null).toBeNull();
});

test('아트워크 picks a game for its icon slot, and retro shows the box art view the retro page used to hold', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await signIn(page);
  await page.goto('/admin/metadata/artwork');
  await page.locator('#mt-items .mt-item', { hasText: 'Test Game' }).click();
  await expect(page.locator('#mt-pic')).toBeVisible();
  await expect(page.locator('#mt-pic [data-pic="pick"]')).toBeVisible();

  await page.locator('#mt-kind [data-kind="retro"]').click();
  await expect(page.locator('#ra-systems')).toBeVisible();
  await expect(page.locator('#mt-pick')).toBeHidden();
  await expect(page.locator('#retro-subtabs')).toHaveCount(0);

  await page.locator('#mt-kind [data-kind="homebrew"]').click();
  await expect(page.locator('#mt-pick')).toBeVisible();
  await expect(page.locator('#tab-retro')).toBeHidden();
  expect(errors).toEqual([]);
});

test('the retro page keeps its other views and sends its old names address to 제목', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin/retro');
  await expect(page.locator('#retro-subtabs [data-sub="art"], #retro-subtabs [data-sub="names"]')).toHaveCount(0);
  await expect(page.locator('#retro-subtabs [data-sub="cores"]')).toBeVisible();
  await page.goto('/admin/retro?view=names');
  await expect(page).toHaveURL(/\/admin\/metadata\/titles\?kind=retro/);
  await expect(page.locator('#rk-guesses')).toBeVisible();
});
