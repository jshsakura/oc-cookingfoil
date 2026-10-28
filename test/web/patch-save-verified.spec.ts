import { test, expect, type Page } from '@playwright/test';
import { signIn } from './admin-sign-in';

// The 검수됨 mark on game patches and saves: the admin's pill on the library tab,
// the library's edit panel for a patch, and the green badge the library shows for both.
const listed = async (page: Page, kind: 'patches' | 'saves', name: string) =>
  ((await (await page.request.get(`/api/${kind}`)).json())[kind] as { name: string; verified: boolean }[]).find((x) => x.name === name)?.verified;
const idOf = async (page: Page, kind: 'patches' | 'saves', name: string) =>
  ((await (await page.request.get(`/api/${kind}`)).json())[kind] as { id: string; name: string }[]).find((x) => x.name === name)!.id;
// Back off, so other specs see the items as they left them.
const unmark = async (page: Page, kind: 'patch' | 'save', id: string) =>
  page.request.post(`/admin/api/content/${kind}/verified`, { data: { id, verified: false }, headers: { Origin: new URL(page.url()).origin } });
/** The library's list of `view` with the game's card open. */
async function openGame(page: Page, view: 'patches' | 'saves') {
  await page.goto(`/#${view}`);
  const head = page.locator(`#${view}-list .xhead`, { hasText: 'Test Game' });
  await expect(head).toBeVisible();
  if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click();
}

test('the 검수 pill on a patch row and a save row marks them for the library and takes it off again', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin#library/patches');
  const pill = page.locator('#lib-patches .pt-row', { hasText: '게임 데이터' }).getByRole('button', { name: '게임 데이터 검수됨', exact: true });
  await expect(pill).toHaveAttribute('aria-pressed', 'false');
  await expect(pill).toHaveText('검수 전');
  await pill.click();
  await expect(page.locator('#toast')).toContainText('검수됨 배지를 붙였습니다');
  await expect.poll(() => listed(page, 'patches', '게임 데이터')).toBe(true);
  await expect(pill).toHaveAttribute('aria-pressed', 'true');
  await expect(pill).toHaveText('검수됨');
  await pill.click();
  await expect.poll(() => listed(page, 'patches', '게임 데이터')).toBe(false);
  await expect(pill).toHaveAttribute('aria-pressed', 'false');

  await page.goto('/admin/saves');
  const save = page.locator('#lib-saves .pt-row', { hasText: 'All unlocked' }).getByRole('button', { name: 'All unlocked 검수됨', exact: true });
  await save.click();
  await expect.poll(() => listed(page, 'saves', 'All unlocked')).toBe(true);
  await expect(save).toHaveAttribute('aria-pressed', 'true');

  // The library shows it beside the save's name and first among its detail's pills.
  await page.addInitScript(() => { try { localStorage.setItem('cookingfoil:lang', 'ko'); } catch { /* none */ } });
  await openGame(page, 'saves');
  // Its Korean name, when the admin spec gave it one.
  const row = page.locator('#saves-list .xrow', { hasText: /All unlocked|전부 열림/ });
  await expect(row.locator('.xname .pill.verified')).toHaveText('검수됨');
  await row.click();
  await expect(page.locator('#xm-pills > :first-child .cc-verified')).toHaveText('검수됨');
  await unmark(page, 'save', await idOf(page, 'saves', 'All unlocked'));
});

test("a patch's edit panel in the library turns 검수됨 on, and the list shows the badge without a reload", async ({ page }) => {
  await signIn(page);
  await page.addInitScript(() => { try { localStorage.setItem('cookingfoil:lang', 'ko'); } catch { /* none */ } });
  await openGame(page, 'patches');
  const row = () => page.locator('#patches-list .xrow', { hasText: '게임 데이터' });
  await expect(row().locator('.pill.verified')).toHaveCount(0);
  await row().click();
  await page.locator('#xmodal .modal-gear').click();
  const sw = page.locator('#xmodal .ef-switch', { hasText: '검수됨' }).locator('input');
  await expect(sw).not.toBeChecked();
  await sw.check();
  await page.locator('#xmodal .arted form button[type=submit]').first().click();
  await expect.poll(() => listed(page, 'patches', '게임 데이터')).toBe(true);
  await page.locator('#xmodal .modal-gear').click();
  await expect(page.locator('#xm-pills > :first-child .cc-verified')).toHaveText('검수됨');
  await page.keyboard.press('Escape');
  const badge = row().locator('.pill.verified');
  await expect(badge).toHaveText('검수됨');
  // On the name's line, centred with it.
  const [nb, bb] = await Promise.all([row().locator('.xname-text').boundingBox(), badge.boundingBox()]);
  expect(Math.abs((nb!.y + nb!.height / 2) - (bb!.y + bb!.height / 2))).toBeLessThan(1.5);
  await unmark(page, 'patch', await idOf(page, 'patches', '게임 데이터'));
});
