import fs from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { signIn } from './admin-sign-in';


const apps = Array.from({ length: 60 }, (_, i) => ({
  id: `app-${i}`, app: `app${i}`, name: `Sample App ${String(i).padStart(2, '0')}`, version: '1.0', source: 'manual',
  enabled: true, kind: 'tool', install_type: 'nro', size: 1048576, patches: i === 0 ? [{ id: 'p0', name: 'Korean text', size: 2048, verified: true }] : [], saves: [], banner_url: null, screenshots: [],
}));
const recommended = Array.from({ length: 30 }, (_, i) => ({
  repo: `example/tool-${i}`, added: i === 0, purpose: { ko: `도구 ${i}`, en: `Tool ${i}` },
}));

test('homebrew app cards and recommended cards page and search', async ({ page }) => {
  await page.route('**/admin/api/homebrew', (route) => route.request().method() === 'GET'
    ? route.fulfill({ json: { recommended, sources: [], manual: [] } }) : route.continue());
  await page.route('**/admin/api/homebrew/apps', (route) => route.fulfill({ json: { apps, held: [] } }));
  await signIn(page);
  await page.goto('/admin/homebrew?tab=apps');

  // Apps are cards, 24 to a page, with the list's own pager and search.
  const rows = page.locator('#hb-apps .src-card');
  await expect(rows).toHaveCount(24);
  fs.mkdirSync('out/web', { recursive: true });
  await rows.nth(0).scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'out/web/admin-homebrew-cards.png' });
  await expect(page.locator('#hb-apps-bar .pg-info')).toContainText('1-24 / 60개');
  await page.locator('#hb-apps-bar').getByRole('button', { name: '3 쪽' }).click();
  await expect(rows).toHaveCount(12);

  await page.getByLabel('앱 찾기').fill('app 07');
  await expect(rows).toHaveCount(1);
  await expect(rows.first().locator('.src-foot').getByRole('button', { name: '설명' })).toBeVisible();
  await page.getByLabel('앱 찾기').fill('zzz');
  await expect(page.locator('#hb-apps .empty')).toHaveText('찾은 앱이 없습니다.');

  // Recommended: its own sub-tab, 12 per page, and a pick survives a page change.
  await page.locator('aside.adm-side a.adm-task[href*="tab=reco"]').click();
  const cards = page.locator('#hb-reco label');
  await expect(cards).toHaveCount(12);
  await cards.nth(1).locator('input').check();
  await page.locator('#hb-reco-bar').getByRole('button', { name: '2 쪽' }).click();
  await expect(cards.first().locator('input')).not.toBeChecked();
  await page.locator('#hb-reco-bar').getByRole('button', { name: '1 쪽' }).click();
  await expect(cards.nth(1).locator('input')).toBeChecked();
});
