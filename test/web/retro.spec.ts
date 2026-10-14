import { test, expect, type Page } from '@playwright/test';
import { generate } from 'otplib';
import fs from 'node:fs';

// The web server's retro folder (test/web/server.mjs) holds Super Shinobi II twice,
// as the official Korean release and as a patch, and Gunbird's World and Japanese sets.
const SECRET = 'KRSXG5CTMVRXEZLUKRSXG5CTMVRXEZLU';

async function signIn(page: Page) {
  await page.goto('/admin?enrolled=1');
  await page.getByLabel('인증 앱 코드').fill(await generate({ secret: SECRET }));
  await page.getByRole('button', { name: '들어가기', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'CookingFoil 관리', exact: true })).toBeVisible();
}

test('the web page shows one card per game and picks another version in its window', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('cookingfoil:lang', 'ko'); } catch { /* none */ } });
  await page.goto('/#retro');
  const cards = page.locator('#retro-games .game');
  await expect(cards).toHaveCount(2);
  const shinobi = cards.filter({ hasText: '슈퍼 시노비' });
  await expect(shinobi).toContainText('버전 2개');
  await expect(shinobi).toContainText('Japan, Korea');
  await shinobi.click();
  const versions = page.locator('#modal-extras .version-row');
  await expect(versions).toHaveCount(2);
  await expect(versions.first()).toContainText('추천');
  await expect(versions.first()).toHaveAttribute('aria-pressed', 'true');
  fs.mkdirSync('out/web', { recursive: true });
  await page.screenshot({ path: 'out/web/retro-versions.png' });
  await versions.nth(1).click();
  await expect(page.locator('#modal-desc')).toContainText('J-K v20130609');
  await expect(page.locator('#modal-extras .version-row[aria-pressed="true"]')).toContainText('J-K v20130609');
});

test('the admin retro tab lists the versions of a game, picks the one shown and shows arcade sets', async ({ page, request }) => {
  await signIn(page);
  await page.getByRole('link', { name: '레트로' }).click();
  const list = page.locator('#rv-list');
  await expect(list).toContainText('공식 한국어판입니다');
  const patchRow = list.locator('tr', { hasText: 'J-K v20130609' });
  await patchRow.getByRole('button', { name: '추천 버전으로 정합니다' }).click();
  await expect(list).toContainText('관리자가 정했습니다');
  const listed = await (await request.get('/api/retro/games?system=md')).json();
  expect(listed.games.map((g: { variant: string }) => g.variant)).toEqual(['J-K v20130609']);
  await page.screenshot({ path: 'out/web/admin-retro-versions.png', fullPage: true });
  await list.locator('tr', { hasText: 'Japan, Korea' }).getByRole('button', { name: '추천 버전으로 정합니다' }).click();
  await expect(list).toContainText('공식 한국어판입니다');

  await page.locator('[data-rv="sets"]').click();
  await expect(page.locator('#rv-summary')).toContainText('게임 1개, 세트 2개입니다');
  await expect(list).toContainText('해외판입니다');
  await page.locator('[data-rv="trash"]').click();
  await expect(list).toContainText('휴지통이 비어 있습니다');
});
