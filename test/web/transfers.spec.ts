import { test, expect, type Page } from '@playwright/test';
import { signIn } from './admin-sign-in';
import fs from 'node:fs';

// The 다운로드 기록 section in the logs tab: cards per route for the last day,
// a slow-tunnel note, running transfers first, and route filter chips.

const now = Date.now();
const rec = (id: string, route: string, mbps: number, extra: Record<string, unknown> = {}) => ({
  id, startedAt: now - 400_000, endedAt: now - 60_000, file: { path: `/${id}.nsp`, name: `${id}.nsp` },
  fileSize: 2_100_000_000, bytes: 2_100_000_000, requests: 120, peakConnections: 4, route,
  client: 'CookingFoil/0.3.72', who: { kind: 'device', id: 'ab12cd34', label: '기기 ab12cd34' },
  remote: { scope: route === 'tunnel' ? 'public' : 'private', country: route === 'tunnel' ? 'KR' : null },
  activeMs: 300_000, mbps, complete: true, ...extra,
});

test('the logs tab shows download records: slow tunnel, live rows first, filters by route', async ({ page }) => {
  await signIn(page);
  // The real endpoint answers in the shape the page reads.
  const real = await page.request.get('/admin/api/transfers');
  expect(real.status()).toBe(200);
  const body = await real.json();
  expect(Object.keys(body.summary).sort()).toEqual(['direct', 'lan', 'other', 'tunnel']);
  expect(Array.isArray(body.active) && Array.isArray(body.recent)).toBe(true);

  let liveBytes = 500_000_000;
  const seen: string[] = [];
  await page.route('**/admin/api/transfers*', async (route) => {
    const url = new URL(route.request().url());
    seen.push(url.searchParams.get('route') ?? '');
    const all = [rec('tunnel-game', 'tunnel', 3.1), rec('direct-game', 'direct', 38.4), rec('lan-game', 'lan', 61.2, { complete: false, bytes: 1_000_000_000 })];
    const want = url.searchParams.get('route');
    const recent = want ? all.filter((r) => r.route === want) : all;
    liveBytes += 100_000_000;
    const live = { ...rec('live-game', 'tunnel', 2.5), endedAt: null, bytes: liveBytes, inflight: 3 };
    await route.fulfill({ json: {
      active: !want || want === 'tunnel' ? [live] : [], recent, total: recent.length, quietSeconds: 20,
      summary: { tunnel: { count: 9, medianMbps: 3.1, bestMbps: 4.0 }, direct: { count: 4, medianMbps: 38.4, bestMbps: 41.0 },
        lan: { count: 2, medianMbps: 61.2, bestMbps: 63.5 }, other: { count: 0, medianMbps: null, bestMbps: null } },
    } });
  });

  await page.locator('nav.tabs a[data-group="ops"]').click();
  const section = page.locator('#tab-logs');
  await expect(section.getByRole('heading', { name: '다운로드 기록' })).toBeVisible();
  await expect(page.locator('#xf-cards .card')).toHaveCount(3);
  await expect(page.locator('#xf-cards .card.slow')).toContainText('터널');
  await expect(page.locator('#xf-slow')).toBeVisible();
  await expect(page.locator('#xf-slow')).toContainText('집 안');

  const rows = page.locator('#xf-table .ag-row[row-id]');
  await expect(rows).toHaveCount(4);
  await expect(rows.first()).toHaveClass(/live/);
  await expect(rows.first()).toContainText('받는 중');
  await expect(rows.first()).toContainText('live-game.nsp');
  await expect(page.locator('#xf-table .ag-row[row-id="lan-game"]')).toContainText('일부');
  await expect(page.locator('#xf-table .ag-row[row-id="direct-game"]')).toContainText('전용 주소');

  // A refresh shows the live row's new numbers.
  const before = await rows.first().innerText();
  await expect.poll(async () => rows.first().innerText(), { timeout: 8000 }).not.toBe(before);

  fs.mkdirSync('out/web', { recursive: true });
  await section.screenshot({ path: 'out/web/admin-transfers.png' });

  await page.locator('#xf-routes').getByRole('button', { name: '전용 주소' }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toHaveAttribute('row-id', 'direct-game');
  expect(seen).toContain('direct');

  // Phone width: the page does not scroll sideways; the grid scrolls its own columns and still holds every value.
  await page.setViewportSize({ width: 375, height: 800 });
  const direct = page.locator('#xf-table .ag-row[row-id="direct-game"]');
  await expect(direct).toContainText('38.4 MB/s');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.locator('#xf-routes').getByRole('button', { name: '전체' }).click();
  await expect(rows).toHaveCount(4);
  await section.screenshot({ path: 'out/web/admin-transfers-phone.png' });
});
