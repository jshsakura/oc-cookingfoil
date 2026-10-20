import { test, expect } from '@playwright/test';
import { signIn } from './admin-sign-in';

const src = (repo: string, extra = {}) => ({
  id: repo.replace('/', '-').toLowerCase(), repo, kind: 'tool', tag: 'v1.0.0', checked_at: Date.now() - 3 * 3600_000,
  assets: ['app.nro'], chosen: 'app.nro', pattern: null, description: { github: 'A short description of what the app does on the console.' },
  cached: { version: '1.0.0', current: true, size: 32 * 2 ** 20, name: repo.split('/')[1] }, install: { mode: 'nro' }, ...extra,
});

// Registered repositories are cards, the buttons in each card's footer, not a cramped table row.
test('registered GitHub repositories show as cards with their buttons in the footer', async ({ page }) => {
  await signIn(page);
  await page.route('**/admin/api/homebrew', (route) => route.fulfill({ json: {
    recommended: [], manual: [],
    sources: [src('example/one'), src('example/two', { assets: ['a.nro', 'b.nro'], chosen: 'a.nro' }), src('example/three', { cached: null })],
  } }));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/admin#homebrew');
  await page.getByRole('tab', { name: 'GitHub 저장소' }).click();
  const cards = page.locator('#hb-sources .src-card');
  await expect(cards).toHaveCount(3);
  const first = cards.first();
  await expect(first.locator('.src-head a')).toHaveText('example/one');
  const foot = first.locator('.src-foot');
  for (const name of ['설명', '지금 확인', '삭제']) await expect(foot.getByRole('button', { name })).toBeVisible();
  await expect(cards.nth(1).getByRole('combobox', { name: '쓸 파일' })).toBeVisible();
  await expect(page.locator('#hb-sources .ag-root')).toHaveCount(0);
  await page.locator('#hb-sources').screenshot({ path: '/tmp/claude-3000/-home-jshsakura-workspace-oc-cookingfoil/8928e3b4-daee-45b4-852d-917d970b82c9/scratchpad/sources.png' });
});
