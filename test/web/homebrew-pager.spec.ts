import { test, expect, type Page } from '@playwright/test';
import { signIn } from './admin-sign-in';


const apps = Array.from({ length: 60 }, (_, i) => ({
  id: `app-${i}`, app: `app${i}`, name: `Sample App ${String(i).padStart(2, '0')}`, version: '1.0', source: 'manual',
  enabled: true, kind: 'tool', install_type: 'nro', size: 1048576, patches: [], saves: [], banner_url: null, screenshots: [],
}));
const recommended = Array.from({ length: 30 }, (_, i) => ({
  repo: `example/tool-${i}`, added: i === 0, purpose: { ko: `도구 ${i}`, en: `Tool ${i}` },
}));

test('the homebrew app grid pages and searches, and the recommended cards page', async ({ page }) => {
  await page.route('**/admin/api/homebrew', (route) => route.request().method() === 'GET'
    ? route.fulfill({ json: { recommended, sources: [], manual: [] } }) : route.continue());
  await page.route('**/admin/api/homebrew/apps', (route) => route.fulfill({ json: { apps, held: [] } }));
  await signIn(page);
  await page.locator('nav.tabs a[data-tab="homebrew"]').click();

  // The app grid: 50 to a page, the grid's own pager and search.
  const rows = page.locator('#hb-apps .ag-row:not(.ag-full-width-row)');
  await expect(rows).toHaveCount(50);
  await expect(page.locator('#hb-apps .ag-paging-row-summary-panel')).toContainText('60');
  await page.locator('#hb-apps .ag-paging-button[aria-label="다음"]').click();
  await expect(rows).toHaveCount(10);

  await page.getByLabel('앱 찾기').fill('app 07');
  await expect(rows).toHaveCount(1);
  await page.getByLabel('앱 찾기').fill('zzz');
  await expect(rows).toHaveCount(0);

  // Recommended: its own sub-tab, 12 per page, and a pick survives a page change.
  await page.getByRole('tab', { name: '추천 홈브류' }).click();
  const cards = page.locator('#hb-reco label');
  await expect(cards).toHaveCount(12);
  await cards.nth(1).locator('input').check();
  await page.locator('#hb-reco-bar').getByRole('button', { name: '2 쪽' }).click();
  await expect(cards.first().locator('input')).not.toBeChecked();
  await page.locator('#hb-reco-bar').getByRole('button', { name: '1 쪽' }).click();
  await expect(cards.nth(1).locator('input')).toBeChecked();
});
