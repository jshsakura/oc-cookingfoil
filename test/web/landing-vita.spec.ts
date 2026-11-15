import { test, expect } from '@playwright/test';

// The page splits by platform like the clients: Switch, PS Vita and retro on top, each with its own views.
// PS Vita reads what the account's Vita reads: its backed-up games and saves, and the Vita homebrew and plugins.
const GAMES = [
  { id: 'PCSE00001', platform: 'vita', title: 'Vita Game', region: 'US', version: '01.05', bytes: 1048576, updatedAt: Date.UTC(2026, 10, 1), units: ['app:PCSE00001', 'savedata:PCSE00001'], icon: null, cover: null },
  { id: 'ULUS10041', platform: 'psp', title: 'PSP Game', region: 'US', version: '1.01', bytes: 2048, updatedAt: Date.UTC(2026, 10, 2), units: ['psp-game:ULUS10041'], icon: null, cover: null },
];
const APPS = [
  { id: 'm-aaaaaaaaaaaa', install_type: 'vpk', name: 'Vita App', display_version: '1.2', version: '01.02', title_id: 'VAPP00001', size: 4096, icon_url: null, description: 'An app.' },
  { id: 'm-bbbbbbbbbbbb', install_type: 'plugin', name: 'Vita Plugin', display_version: '2.0', sections: ['*main'], icon_url: null, description: null },
];

test('the top tabs are Switch, PS Vita and retro, and PS Vita lists what the account\'s Vita gets', async ({ page }) => {
  const asked: string[] = [];
  await page.route('**/api/backups/games?platform=vita', (r) => { asked.push('games'); return r.fulfill({ json: { games: GAMES } }); });
  await page.route('**/api/homebrew?*', (r) => {
    const vita = new URL(r.request().url()).searchParams.get('platform') === 'vita';
    if (vita) asked.push('apps');
    return r.fulfill({ json: { homebrew: vita ? APPS : [] } });
  });
  await page.addInitScript(() => { try { localStorage.setItem('cookingfoil:lang', 'ko'); } catch { /* none */ } });
  await page.goto('/');
  await expect(page.locator('.tabs [data-tab]:visible')).toHaveText(['Switch', 'PS Vita', '레트로']);
  await expect(page.locator('.tabs [data-tab]:visible .tab-ico')).toHaveCount(3);
  await page.locator('.tabs [data-tab="vita"]').click();
  await expect(page).toHaveURL(/#vita$/);
  await expect(page.locator('#subtabs [data-view]')).toHaveText(['게임', '세이브', '홈브류', '플러그인']);
  await expect(page.locator('#vita-games-list .game .name')).toHaveText(['Vita Game']);
  await expect(page.locator('#vita-games-list .game .pill')).toHaveCount(0);
  await page.locator('#subtabs [data-view="vita-saves"]').click();
  await expect(page.locator('#vita-saves-list .xname')).toHaveText(['Vita Game']);
  await page.locator('#subtabs [data-view="vita-homebrew"]').click();
  await expect(page.locator('#vita-homebrew-list .xname')).toHaveText(['Vita App']);
  await page.locator('#subtabs [data-view="vita-plugins"]').click();
  await expect(page.locator('#vita-plugins-list .xmeta')).toHaveText('2.0 · *main');
  expect(asked).toEqual(['games', 'apps']);
});

test('without backups or Vita apps there is no PS Vita tab, and an old #vita link lands on the games', async ({ page }) => {
  await page.route('**/api/backups/games?platform=vita', (r) => r.fulfill({ status: 404, json: { code: 'backups-off' } }));
  await page.route('**/api/homebrew?*', (r) => r.fulfill({ json: { homebrew: [] } }));
  await page.addInitScript(() => { try { localStorage.setItem('cookingfoil:lang', 'ko'); } catch { /* none */ } });
  await page.goto('/#vita');
  await expect(page.locator('.tabs [data-tab="vita"]')).toBeHidden();
  await expect(page.locator('.tabs [data-tab="games"]')).toHaveClass(/active/);
});

test('PS Vita games lists the library first, and a backed-up game the library already has only once', async ({ page }) => {
  const LIBRARY = [
    { id: 'PCSE00001', name: 'Vita Game', version: '01.00', patch_version: '01.05', region: 'US', size: 3145728, icon_url: null, dlc_count: 0, files: [] },
    { id: 'PCSE00002', name: 'Library Only', version: '01.00', patch_version: null, region: 'EU', size: 1024, icon_url: null, dlc_count: 0, files: [] },
  ];
  await page.route('**/api/backups/games?platform=vita', (r) => r.fulfill({ json: { games: GAMES } }));
  await page.route('**/api/vita/library', (r) => r.fulfill({ json: { success: true, data: { games: LIBRARY }, error: null, meta: { total: 2 } } }));
  await page.route('**/api/homebrew?*', (r) => r.fulfill({ json: { homebrew: [] } }));
  await page.addInitScript(() => { try { localStorage.setItem('cookingfoil:lang', 'ko'); } catch { /* none */ } });
  await page.goto('/#vita');
  await expect(page.locator('#vita-games-list .game .name')).toHaveText(['Library Only', 'Vita Game']);
  await expect(page.locator('#vita-games-list .game').last().locator('.pill')).toHaveText(['업데이트']);
  await expect(page.locator('#vita-games-list .game').last().locator('.size-badge')).toHaveText('3.00 MB');
});
