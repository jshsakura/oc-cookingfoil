import { test, expect, type Page } from '@playwright/test';
import { signIn } from './admin-sign-in';


const apps = Array.from({ length: 30 }, (_, i) => ({
  id: `app-${i}`, app: `app${i}`, name: `Sample App ${String(i).padStart(2, '0')}`, version: '1.0', source: 'manual',
  enabled: true, kind: 'tool', install_type: 'nro', size: 1048576, patches: [], saves: [], banner_url: null, screenshots: [],
}));
const recommended = Array.from({ length: 30 }, (_, i) => ({
  repo: `example/tool-${i}`, added: i === 0, purpose: { ko: `도구 ${i}`, en: `Tool ${i}` },
}));

test('the homebrew lists page, search and change how many show per page', async ({ page }) => {
  await page.route('**/admin/api/homebrew', (route) => route.request().method() === 'GET'
    ? route.fulfill({ json: { recommended, sources: [], manual: [] } }) : route.continue());
  await page.route('**/admin/api/homebrew/apps', (route) => route.fulfill({ json: { apps, held: [] } }));
  await signIn(page);
  await page.locator('nav.tabs a[data-tab="homebrew"]').click();

  const rows = page.locator('#hb-apps tr:not(:has(th))');
  await expect(rows).toHaveCount(25);
  await expect(page.locator('#hb-apps-bar .pg-info')).toContainText('1-25 / 30개');

  await page.getByRole('button', { name: '2 쪽' }).first().click();
  await expect(rows).toHaveCount(5);
  await expect(page.locator('#hb-apps-bar .pg-info')).toContainText('26-30 / 30개');

  await page.getByLabel('앱 몇 개씩 볼지').selectOption('10');
  await expect(rows).toHaveCount(10);

  await page.getByLabel('앱 찾기').fill('app 07');
  await expect(rows).toHaveCount(1);
  await page.getByLabel('앱 찾기').fill('zzz');
  await expect(page.locator('#hb-apps .empty')).toHaveText('찾은 앱이 없습니다.');

  // Recommended: 12 per page, and a pick survives a page change.
  const cards = page.locator('#hb-reco label');
  await expect(cards).toHaveCount(12);
  await cards.nth(1).locator('input').check();
  await page.locator('#hb-reco-bar').getByRole('button', { name: '2 쪽' }).click();
  await expect(cards.first().locator('input')).not.toBeChecked();
  await page.locator('#hb-reco-bar').getByRole('button', { name: '1 쪽' }).click();
  await expect(cards.nth(1).locator('input')).toBeChecked();
});
