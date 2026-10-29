import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import { shot } from './shots';

const OWN = '0100ABCD00000000', ABSENT = '0100ABCD00010000', UPDATE_ONLY = '0100ABCD00020000';
const patch = (tid: string | null, name: string, homebrew?: string) => ({
  id: name, title_id: tid, homebrew, name: 'Patch', size: 1, files: 1,
  required: true, kinds: ['romfs', 'exefs', 'cheats'], game: { name },
});

async function setup(page: Page) {
  await page.addInitScript(() => localStorage.setItem('cookingfoil:lang', 'ko'));
  await page.route('**/api/library/info*', route => route.fulfill({ json: {
    features: ['user-patches', 'library-saves', 'homebrew'],
  } }));
  await page.route('**/api/library/sections', route => route.fulfill({ json: { sections: [{
    id: 'all', items: [
      { title_id: OWN.toLowerCase(), app_type: 'base', name: 'Owned game' },
      { title_id: '0100ABCD00020800', base_title_id: UPDATE_ONLY, app_type: 'update', name: 'Update alone' },
    ],
  }] } }));
  await page.route('**/api/patches', route => route.fulfill({ json: { patches: [
    patch(OWN, 'Owned game'), patch(ABSENT, 'Absent game'), patch(UPDATE_ONLY, 'Update alone'),
    patch(null, 'Present port', 'portgame'), patch(null, 'Missing port', 'missingport'),
  ] } }));
  await page.route('**/api/homebrew?*', route => route.fulfill({ json: {
    homebrew: [{ app: 'portgame', name: 'Present port', kind: 'port', size: 1 }],
  } }));
  await page.route('**/api/saves*', route => route.fulfill({ json: { games: [
    { key: OWN, titleId: OWN, game: { name: 'Owned game' }, count: 2 },
    { key: ABSENT, titleId: ABSENT, game: { name: 'Absent game' }, count: 1 },
    { key: 'hb:missingport', homebrew: 'missingport', count: 1 },
  ] } }));
}

test('patch cards show only server title availability, including ports and update-only titles', async ({ page }) => {
  await setup(page);
  const saveRequests: string[] = [];
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/saves') saveRequests.push(request.url()); });
  await page.goto('/#patches');
  const card = (name: string) => page.locator('#patches-list .xhead').filter({ has: page.locator('strong', { hasText: name }) });
  for (const [name, game] of [
    ['Owned game', '서버에 있음'],
    ['Absent game', '서버에 없음'],
    ['Update alone', '서버에 없음'],
    ['Present port', '서버에 있음'],
    ['missingport', '서버에 없음'],
  ]) {
    await expect(card(name).locator('.server-availability')).toHaveText(game);
    await expect(card(name).locator('.save-availability')).toHaveCount(0);
  }
  await card('Owned game').focus();
  await page.keyboard.press('Enter');
  await expect(card('Owned game')).toHaveAttribute('aria-expanded', 'true');
  await page.setViewportSize({ width: 320, height: 800 });
  await page.emulateMedia({ colorScheme: 'dark' });
  for (const badge of await page.locator('#patches-list .xbadges .pill').all()) {
    const box = await badge.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(320);
  }
  fs.mkdirSync('out/web', { recursive: true });
  await shot(page, { path: 'out/web/extras-availability-phone.png', fullPage: true });
  for (const [code, game] of [
    ['en', 'On server'], ['ja', 'サーバーにあり'], ['zh', '服务器上有'],
  ]) {
    await page.locator('#lang-btn').click();
    await page.locator(`#lang-list [data-lang="${code}"]`).click();
    await expect(card('Owned game').locator('.server-availability')).toHaveText(game);
    await expect(card('Owned game').locator('.save-availability')).toHaveCount(0);
  }
  expect(saveRequests).toEqual([]);
});

test('save game summaries show whether the game itself is on the server', async ({ page }) => {
  await setup(page);
  await page.goto('/#saves');
  await expect(page.locator('#saves-list .server-availability')).toHaveCount(3);
  const owned = page.locator('#saves-list .xhead', { hasText: 'Owned game' });
  const absent = page.locator('#saves-list .xhead', { hasText: 'Absent game' });
  await expect(owned.locator('.server-availability')).toHaveText('서버에 있음');
  await expect(absent.locator('.server-availability')).toHaveText('서버에 없음');
});

test('failed catalog requests stay unverified instead of claiming titles are missing', async ({ page }) => {
  await setup(page);
  await page.route('**/api/library/sections', route => route.fulfill({ status: 503, json: {} }));
  await page.route('**/api/saves*', route => route.fulfill({ status: 503, json: {} }));
  await page.route('**/api/homebrew?*', route => route.fulfill({ status: 503, json: {} }));
  await page.goto('/#patches');
  await expect(page.locator('#patches-list .server-availability')).toHaveText(Array(5).fill('서버 확인 전'));
  await expect(page.locator('#patches-list .save-availability')).toHaveCount(0);
});

test('a slow server catalog updates existing badges after the patch cards are already visible', async ({ page }) => {
  await setup(page);
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/library/sections', async route => {
    await ready;
    await route.fulfill({ json: { sections: [{ id: 'all', items: [
      { title_id: OWN, app_type: 'base', name: 'Owned game' },
    ] }] } });
  });
  try {
    await page.goto('/#patches', { waitUntil: 'domcontentloaded' });
    const head = page.locator('#patches-list .xhead', { hasText: 'Owned game' });
    await expect(head.locator('.server-availability')).toHaveText('서버 확인 전');
    await head.focus();
    release();
    await expect(head.locator('.server-availability')).toHaveText('서버에 있음');
    await expect(head).toBeFocused();
    await expect(head).toHaveAttribute('aria-expanded', 'false');
  } finally {
    release();
  }
});
