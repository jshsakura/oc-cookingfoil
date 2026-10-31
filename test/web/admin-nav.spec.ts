import { test, expect } from '@playwright/test';
import { signIn } from './admin-sign-in';

// Every hash the admin page answered before the menu regrouping, and the section it opens.
const HASHES: [string, string][] = [
  ['#overview', 'tab-overview'], ['#users', 'tab-users'], ['#devices', 'tab-devices'], ['#settings', 'ss-list'],
  ['#alerts', 'tab-alerts'], ['#logs', 'xf-cards'], ['#featured', 'tab-featured'], ['#library', 'tab-library'],
  ['#nsz', 'tab-nsz'], ['#upload', 'tab-upload'], ['#inbox', 'tab-inbox'], ['#homebrew', 'tab-homebrew'], ['#retro', 'tab-retro'],
  ['#library/files', 'tab-library'], ['#organize', 'tab-organize'], ['#library/verify', 'tab-library'],
  ['#patches', 'tab-patches'], ['#saves', 'tab-saves'], ['#library/info', 'tab-library'], ['#library/server', 'ss-list'],
  ['#users/google', 'tab-users'], ['#devices/approved', 'tab-devices'], ['#devices/clients', 'tab-devices'],
  ['#homebrew/reco', 'tab-homebrew'], ['#homebrew/sources', 'tab-homebrew'],
  ['#settings/integrations', 'intg-h'], ['#settings/security', 'tfa'], ['#settings/tokens', 'mcp-on'],
];

test('every earlier admin hash still opens its section', async ({ page }) => {
  test.setTimeout(90_000);
  await signIn(page);
  for (const [hash, section] of HASHES) {
    await page.goto(`/admin${hash}`);
    await expect(page.locator(`#${section}`), hash).toBeVisible();
  }
});

test('library sub-pages open the panel their hash names', async ({ page }) => {
  await signIn(page);
  for (const sub of ['files', 'folder', 'verify', 'info']) {
    await page.goto(`/admin#library/${sub}`);
    await expect(page.locator(`[data-lib-panel="${sub}"]`), sub).toBeVisible();
  }
});

test('the upload entry in the header is on every group and leads to the one upload page', async ({ page }) => {
  await signIn(page);
  for (const hash of ['#retro', '#homebrew', '#library', '#overview']) {
    await page.goto(`/admin${hash}`);
    const entry = page.locator('#up-entry');
    await expect(entry, hash).toBeVisible();
    await expect(entry).toHaveAttribute('aria-label', '파일 올리기');
  }
  await page.goto('/admin#overview');
  await page.locator('#up-entry').click();
  await expect(page.locator('#tab-upload')).toBeVisible();
  await expect(page.locator('#up-entry')).toHaveAttribute('aria-current', 'page');
});

test('where the file explorer shows, the header upload asks for files for the open folder and stays there', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin/games?tab=folder');
  await expect(page.locator('#fb-refresh')).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#up-entry').click();
  await chooser;
  await expect(page).toHaveURL(/\/admin\/games/);
});

test('the menus are named for what they hold, in every language', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin/games');
  const group = (name: string) => name === 'games'
    ? page.locator('aside.adm-side a[href="/admin/games"] [data-top]')
    : page.locator(`aside.adm-side .adm-grp[data-grp="${name}"] summary [data-top]`);
  await expect(group('games')).toHaveText('게임');
  await expect(group('people')).toHaveText('계정과 기기');
  for (const [lang, games, people] of [['en', 'Games', 'Accounts and devices'], ['ja', 'ゲーム', 'アカウントとデバイス'], ['zh', '游戏', '账户与设备']]) {
    await page.locator('#lang-btn').click();
    await page.locator(`#lang-list [data-admin-lang="${lang}"]`).click();
    await expect(group('games')).toHaveText(games);
    await expect(group('people')).toHaveText(people);
    await expect(page.locator('#up-entry')).toHaveAttribute('aria-label', /./);
  }
  await page.locator('#lang-btn').click();
  await page.locator('#lang-list [data-admin-lang="ko"]').click();
});

test('on the game list the list comes first and the server numbers follow it', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin/games?view=files');
  await expect(page.locator('#lb-list')).toContainText('Test Game');
  const list = await page.locator('#lb-list').boundingBox();
  const stats = await page.locator('#lib-cards').boundingBox();
  expect(list && stats && stats.y > list.y + list.height - 1).toBe(true);
  // One file browser: the separate game-file search is gone, its job is the browser's search.
  await expect(page.locator('#lf-q')).toHaveCount(0);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the file list leads, the top bar keeps one row of real targets and clipped menus say so', async ({ page }) => {
    await signIn(page);
    await page.goto('/admin/games?view=files');
    await expect(page.locator('#lb-list')).toContainText('Test Game');
    const top = await page.locator('#lb-list').evaluate((e) => e.getBoundingClientRect().top + scrollY);
    expect(top).toBeLessThan(844);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

    // One bar on a phone, and every control keeps a real touch target that touches no other.
    const boxes = await page.evaluate(() => ['#adm-menu', '#up-entry', '#lang-btn', '#acct-btn'].map((s) => {
      const r = document.querySelector(s)!.getBoundingClientRect();
      return { s, x: r.x, y: r.y, w: r.width, h: r.height };
    }));
    for (const b of boxes) expect(Math.round(b.h), b.s).toBeGreaterThanOrEqual(44);
    for (const b of boxes.filter((x) => x.s !== '#lang-btn')) expect(Math.round(b.w), b.s).toBeGreaterThanOrEqual(44);
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const [a, b] = [boxes[i], boxes[j]];
        const overlap = a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1;
        expect(overlap, `${a.s} overlaps ${b.s}`).toBe(false);
      }
    }

    // A row that is clipped fades at the hidden edge, and the open page is brought into view.
    const sub = page.locator('#lib-subtabs');
    await expect(sub).toHaveClass(/fade-r/);
    await page.goto('/admin#library/info');
    await expect(sub).toHaveClass(/fade-l/);
    // The row scrolls smoothly to it, so wait for the end of the move.
    await expect.poll(() => page.locator('#lib-subtabs [data-lsub="info"]').evaluate((b) => {
      const r = b.getBoundingClientRect(), p = b.parentElement!.getBoundingClientRect();
      return r.left >= p.left - 1 && r.right <= p.right + 1;
    })).toBe(true);
  });
});
