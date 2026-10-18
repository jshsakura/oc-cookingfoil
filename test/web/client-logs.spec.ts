import { test, expect, type Page } from '@playwright/test';
import { signIn } from './admin-sign-in';


const now = Date.now();
const oldDate = new Date(now - 3 * 86400_000);
oldDate.setHours(23, 11, 37);
const old = oldDate.getTime();
const files = (prefix: string) => [
  { name: `${prefix}-a.log`, size: 48742, at: now },
  { name: `${prefix}-b.log`, size: 2048, at: old },
];
const payload = {
  consoles: [
    { prefix: 'aaaa1111', label: '자동 등록', files: files('aaaa1111') },
    { prefix: 'bbbb2222', label: '자동 등록', files: files('bbbb2222') },
  ],
  bugReports: [
    { prefix: 'aaaa1111', label: '자동 등록', owner: 'example-user', count: 7, first: old, last: now },
    { prefix: 'bbbb2222', label: null, owner: '', count: 3, first: old, last: old },
    { prefix: 'cccc3333', label: '거실', owner: 'example-user', count: 2, first: old, last: old },
    { prefix: 'dddd4444', label: '방', owner: 'example-user', count: 1, first: old, last: old },
  ],
};

test('the logs tab splits into sub-tabs and the client log list stays short and tells same-named consoles apart', async ({ page }) => {
  await page.route('**/admin/api/client-logs', (route) => route.fulfill({ json: payload }));
  await page.route('**/admin/api/client-logs/aaaa1111/*', (route) => route.fulfill({ body: 'line one\nline two', contentType: 'text/plain' }));
  await signIn(page);
  await page.locator('nav.tabs a[data-tab="logs"]').click();

  // Only the download records show at first; the other two groups wait behind their sub-tabs.
  await expect(page.locator('[data-logs-panel="xfer"]')).toBeVisible();
  await expect(page.locator('[data-logs-panel="client"]')).toBeHidden();
  await expect(page.locator('#lockouts')).toBeHidden();

  await page.getByRole('tab', { name: '클라이언트 로그' }).click();
  await expect(page.locator('[data-logs-panel="xfer"]')).toBeHidden();

  // Ranks 1 to 3 are marked, and the table does not run past its box.
  await expect(page.locator('#bug-reports .rk.r1')).toHaveText('1');
  await expect(page.locator('#bug-reports .rk.r3')).toHaveText('3');
  await expect(page.locator('#bug-reports .rk.r2 ~ .r4')).toHaveCount(0);
  const wide = await page.evaluate(() => { const s = document.getElementById('bug-reports')!; return s.scrollWidth - s.clientWidth; });
  expect(wide).toBeLessThanOrEqual(0);

  // Two consoles named alike carry their key prefix.
  await expect(page.locator('#cl-list summary small')).toHaveText(['aaaa1111', 'bbbb2222']);

  // A log row is one short line: today shows the time only, another day month.day and time.
  const first = page.locator('#cl-list details').first().locator('button').first();
  await expect(first.locator('span').first()).toHaveText(/^\d{2}:\d{2}$/);
  await expect(page.locator('#cl-list details').first().locator('button').nth(1).locator('span').first()).toHaveText(`${oldDate.getMonth() + 1}.${oldDate.getDate()} 23:11`);
  const box = await first.locator('span').nth(1).boundingBox();
  expect(box!.height).toBeLessThan(24);

  // Nothing is chosen yet: an empty state, then the log.
  await expect(page.locator('#cl-empty')).toBeVisible();
  await first.click();
  await expect(page.locator('#cl-text')).toHaveText('line one\nline two');
  await expect(page.locator('#cl-empty')).toBeHidden();

  await page.getByRole('tab', { name: '차단과 거부' }).click();
  await expect(page.locator('#lockouts')).toBeVisible();
});
