import { test, expect, type Page } from '@playwright/test';
import { signIn } from './admin-sign-in';

const HANGUL = /[가-힣]/;
// Names the test server's fixtures give their games and patches: content, not page text.
const FIXTURE_NAMES = ['더 슈퍼 시노비 2', '게임 데이터', '한글패치'];

async function pickLang(page: Page, code: string) {
  await page.locator('#lang-btn').click();
  await page.locator(`#lang-list [data-lang="${code}"]`).click();
  await expect(page.locator('#lang-list')).toBeHidden();
}

/** Visible page text with Hangul in it, after the fixtures' own names are taken out. */
async function hangulLines(page: Page) {
  let text = await page.evaluate(() => document.body.innerText);
  for (const name of FIXTURE_NAMES) text = text.replaceAll(name, '');
  return text.split('\n').map((l) => l.trim())
    .filter((l) => HANGUL.test(l) && !FIXTURE_NAMES.some((n) => n.startsWith(l)));
}

test('switched to ja, en or zh, the landing shows no Korean on any tab, the client card included', async ({ page }) => {
  test.setTimeout(90_000);
  // The client card only shows when a build is published; this one is made up.
  await page.route('**/api/library/info', async (route) => {
    const info = await (await route.fetch()).json();
    info.features = [...new Set([...(info.features ?? []), 'client-update', 'enroll'])];
    await route.fulfill({ json: info });
  });
  await page.route('**/api/client/latest', (route) => route.fulfill({ json: { version: '0.4.1', size: 18_664_652, sha256: 'a'.repeat(64) } }));
  await page.addInitScript(() => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('cookingfoil:lang', 'ko'); sessionStorage.setItem('seeded', '1'); } });
  await page.goto('/');
  await expect(page.locator('#client-meta')).toHaveText('버전 0.4.1 · 17.8 MB');

  for (const [lang, version] of [['ja', 'バージョン 0.4.1'], ['en', 'Version 0.4.1'], ['zh', '版本 0.4.1']]) {
    await pickLang(page, lang);
    await expect(page.locator('#client-meta')).toContainText(version);
    for (const tab of ['games', 'retro', 'extras', 'homebrew']) {
      const button = page.locator(`.tabs [data-tab="${tab}"]`);
      await expect(button).toBeVisible();
      await button.click();
      const views = page.locator('#subtabs [data-view]');
      const count = await views.count();
      for (let i = 0; i < Math.max(count, 1); i++) {
        if (count) await views.nth(i).click();
        const view = count ? await views.nth(i).getAttribute('data-view') : tab;
        await expect.poll(() => hangulLines(page), { message: `${lang} ${view}` }).toEqual([]);
      }
    }
  }
});

test('the admin top area follows the language picked on the web, and its account menu changes it', async ({ page }) => {
  await signIn(page);
  const games = page.locator('aside.adm-side .adm-grp[data-grp="games"] summary [data-top]');
  const files = page.locator('aside.adm-side a[href="/admin/games"] [data-top]');
  await expect(games).toHaveText('게임');
  await expect(files).toHaveText('라이브러리');

  await page.goto('/');
  await pickLang(page, 'ja');
  await page.goto('/admin');
  await expect(games).toHaveText('ゲーム');
  await expect(files).toHaveText('ライブラリ');
  await expect(page.locator('aside.adm-side .adm-grp[data-grp="ops"] summary [data-top]')).toHaveText('記録');
  await expect(page.locator('h1.brand')).toHaveAttribute('aria-label', 'CookingFoil サーバー管理');
  await expect(page).toHaveTitle('CookingFoil サーバー管理');

  // The language chip sits left of the account button, as on the web page, not inside the account menu.
  await expect(page.locator('#lang-current')).toHaveText('JA');
  await expect(page.locator('#acct-list [data-admin-lang]')).toHaveCount(0);
  const order = await page.evaluate(() => {
    const chip = document.querySelector('.hdr-right .lang-menu')!.getBoundingClientRect();
    const acct = document.getElementById('acct-btn')!.getBoundingClientRect();
    return chip.right <= acct.left;
  });
  expect(order).toBe(true);
  const pick = async (code: string) => { await page.locator('#lang-btn').click(); await page.locator(`#lang-list [data-admin-lang="${code}"]`).click(); };
  await page.locator('#acct-btn').click();
  await expect(page.locator('#acct-list #logout')).toHaveText('ログアウト');
  await page.keyboard.press('Escape');
  await pick('en');
  await expect(games).toHaveText('Games');
  await expect(files).toHaveText('Library');
  await expect(page.locator('#lang-current')).toHaveText('EN');
  await expect(page.locator('#lang-list')).toBeHidden();
  await expect(page.locator('#lang-list [data-admin-lang="en"]')).toHaveAttribute('aria-checked', 'true');
  await pick('zh');
  await expect(games).toHaveText('游戏');
  await expect(page.locator('#act-heading')).toHaveText('正在运行');
  expect(await page.evaluate(() => localStorage.getItem('cookingfoil:lang'))).toBe('zh');
  const topText = await page.evaluate(() => [...document.querySelectorAll('aside.adm-side, #adm-drawer')].map((n) => (n as HTMLElement).innerText).join('\n'));
  expect(topText).not.toMatch(HANGUL);

  // Back to Korean for the specs that follow and read the admin by its Korean labels.
  await pick('ko');
  await expect(games).toHaveText('게임');
});
