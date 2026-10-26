import { expect, test } from '@playwright/test';
import { signIn } from './admin-sign-in';

test('the grid pager stays small and inside a phone screen', async ({ page }) => {
  await signIn(page);
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/admin');
  await page.evaluate(() => {
    const d = document.createElement('div');
    d.id = 'pager-probe';
    document.querySelector('#tab-overview')!.prepend(d);
    const rows = Array.from({ length: 30 }, (_, i) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>row ${i}</td><td>${i}</td>`;
      return tr;
    });
    (window as any).table('pager-probe', ['name', 'count'], rows, 'none');
  });
  const panel = page.locator('#pager-probe .ag-paging-panel');
  await expect(panel).toBeVisible();
  const input = panel.locator('.ag-paging-number input');
  const box = await input.boundingBox();
  expect(box!.height).toBeLessThanOrEqual(32);
  const panelBox = await panel.boundingBox();
  expect(panelBox!.x + panelBox!.width).toBeLessThanOrEqual(390);
});
