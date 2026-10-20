import { test, expect, type Page } from '@playwright/test';

// The 검수 chip: 검수됨 and the 잘 돼요 count in a detail, with a popover to vote in.
// The test server has no accounts, so the signed-in reader and the vote endpoint are
// stood in for here; /api/votes itself is covered by test/unit/item-votes-api.test.js.

const APP = {
  id: 'm-cccccccccccc', app: 'chipapp', name: 'Chip App', version: '1.0', author: 'someone', kind: 'tool', size: 2048,
  description: '검수 칩을 봅니다.', icon_url: '', download_url: '/api/homebrew/m-cccccccccccc/download', repo_url: null,
  install_path: 'switch/chipapp/chipapp.nro', released_at: '2026-09-01T00:00:00Z',
  verified: true, verified_at: '2026-10-20T00:00:00.000Z', votes: { up: 2, down: 1 }, my_vote: null,
};

/** A reader signed in as an account, and an /api/votes that counts like the server: one vote, null takes it back. */
async function signedInVoter(page: Page, start = { up: 2, down: 1 }) {
  await page.route('**/auth/me', (route) => route.fulfill({ json: { user: 'Viewer', kind: 'password', admin: false, csrf: 'c' } }));
  // What the account menu asks a signed-in reader for; the real server would answer 401 and send the page to /login.
  await page.route('**/api/inbox', (route) => route.fulfill({ json: { enabled: false } }));
  await page.route('**/api/retro/achievements/account**', (route) => route.fulfill({ status: 404, json: { error: 'none' } }));
  let counts = { ...start };
  let mine: 'up' | 'down' | null = null;
  const posted: unknown[] = [];
  await page.route('**/api/votes/**', async (route) => {
    const { vote } = route.request().postDataJSON();
    posted.push(vote);
    if (mine) counts = { ...counts, [mine]: counts[mine] - 1 };
    mine = vote;
    if (mine) counts = { ...counts, [mine]: counts[mine] + 1 };
    await route.fulfill({ json: { ...counts, mine } });
  });
  return posted;
}

async function openTools(page: Page, app = APP) {
  await page.route('**/api/shop/info*', async (route) => {
    const res = await route.fetch();
    const body = res.ok() ? await res.json() : {};
    await route.fulfill({ json: { ...body, features: [...(body.features ?? []), 'homebrew'] } });
  });
  await page.route('**/api/homebrew?*', (route) => route.fulfill({ json: { homebrew: [app] } }));
  await page.addInitScript(() => { try { localStorage.setItem('cookingfoil:lang', 'ko'); } catch { /* none */ } });
  await page.goto('/#tools');
  return page.locator('#tools-list .xrow', { hasText: 'Chip App' });
}

test('a verified app with votes shows its chip, and voting in the popover updates it and the list without a reload', async ({ page }) => {
  const posted = await signedInVoter(page);
  const row = await openTools(page);
  // The list: 검수됨, then the 잘 돼요 count with its thumb.
  await expect(row.locator('.xname .pill.verified')).toHaveText('검수됨');
  await expect(row.locator('.xname .pill.votes')).toHaveText('2');
  await expect(row.locator('.xname .pill.votes svg')).toHaveCount(1);
  await row.click();
  const chip = page.locator('#xm-pills > .check-chip');
  await expect(chip).toBeVisible();
  await expect(chip.locator('.cc-verified')).toHaveText('검수됨');
  await expect(chip.locator('.cc-up')).toHaveText('2');
  await expect(chip).toHaveAttribute('aria-expanded', 'false');

  await chip.click();
  const pop = page.locator('#xm-pills .check-pop');
  await expect(pop).toBeVisible();
  await expect(chip).toHaveAttribute('aria-expanded', 'true');
  await expect(pop.locator('.cp-sub')).toHaveText('관리자 확인 · 2026.10.20');
  await expect(pop.locator('.cp-counts')).toHaveText('잘 돼요 2 · 안 돼요 1');
  const up = pop.getByRole('button', { name: '잘 돼요' });
  const down = pop.getByRole('button', { name: '안 돼요' });
  await expect(up).toHaveAttribute('aria-pressed', 'false');
  await up.click();
  await expect(up).toHaveAttribute('aria-pressed', 'true');
  await expect(pop.locator('.cp-counts')).toHaveText('잘 돼요 3 · 안 돼요 1');
  await expect(chip.locator('.cc-up')).toHaveText('3');
  await expect(row.locator('.xname .pill.votes')).toHaveText('3');
  // Changing the vote moves it; pressing the pressed one takes it back.
  await down.click();
  await expect(down).toHaveAttribute('aria-pressed', 'true');
  await expect(up).toHaveAttribute('aria-pressed', 'false');
  await expect(pop.locator('.cp-counts')).toHaveText('잘 돼요 2 · 안 돼요 2');
  await down.click();
  await expect(down).toHaveAttribute('aria-pressed', 'false');
  await expect(pop.locator('.cp-counts')).toHaveText('잘 돼요 2 · 안 돼요 1');
  expect(posted).toEqual(['up', 'down', null]);

  // Escape closes the popover first, then the window.
  await page.keyboard.press('Escape');
  await expect(pop).toHaveCount(0);
  await expect(chip).toBeFocused();
  await expect(page.locator('#xmodal')).toHaveClass(/open/);
  // An outside click closes it too.
  await chip.click();
  await expect(pop).toBeVisible();
  await page.locator('#xm-title').click();
  await expect(pop).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('#xmodal')).not.toHaveClass(/open/);
});

test('the popover fits a phone, and opens from the keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signedInVoter(page);
  const row = await openTools(page);
  await row.click();
  const chip = page.locator('#xm-pills > .check-chip');
  await chip.focus();
  await page.keyboard.press('Enter');
  const pop = page.locator('#xm-pills .check-pop');
  await expect(pop).toBeVisible();
  await expect(pop.getByRole('button', { name: '잘 돼요' })).toBeFocused();
  const box = (await pop.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  await page.keyboard.press('Enter');
  await expect(pop.getByRole('button', { name: '잘 돼요' })).toHaveAttribute('aria-pressed', 'true');
});

test('a reader who cannot vote sees the chip only when there is something to show', async ({ page }) => {
  // Not signed in: 검수됨 alone, no count at none and no vote buttons.
  const row = await openTools(page, { ...APP, votes: { up: 0, down: 0 } });
  await expect(row.locator('.xname .pill.votes')).toBeHidden();
  await row.click();
  const chip = page.locator('#xm-pills > .check-chip');
  await expect(chip).toHaveText('검수됨');
  await chip.click();
  await expect(page.locator('#xm-pills .check-pop .cp-votes')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  // Neither verified nor voted on: no chip.
  await page.unroute('**/api/homebrew?*');
  await page.route('**/api/homebrew?*', (route) => route.fulfill({ json: { homebrew: [{ ...APP, verified: false, verified_at: null, votes: { up: 0, down: 0 } }] } }));
  await page.reload();
  await page.locator('#tools-list .xrow', { hasText: 'Chip App' }).click();
  await expect(page.locator('#xm-pills > .check-chip')).toBeHidden();
});

test('a retro game carries the chip in its window and its card shows the count after a vote', async ({ page }) => {
  await signedInVoter(page, { up: 0, down: 0 });
  await page.addInitScript(() => { try { localStorage.setItem('cookingfoil:lang', 'ko'); } catch { /* none */ } });
  await page.goto('/#retro');
  const card = page.locator('#retro-games .game').filter({ hasText: '슈퍼 시노비' });
  await expect(card.locator('.pill.votes')).toBeHidden();
  await card.click();
  const chip = page.locator('#modal-pills > .check-chip');
  await expect(chip.locator('.cc-up')).toHaveText('0');
  // The chip is no pill: the window's pills stay what the file is.
  await expect(page.locator('#modal-pills .pill')).toHaveText(['ZIP', '정발']);
  await chip.click();
  await page.locator('#modal-pills .check-pop').getByRole('button', { name: '잘 돼요' }).click();
  await expect(chip.locator('.cc-up')).toHaveText('1');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(card.locator('.pill.votes')).toHaveText('1');
});
