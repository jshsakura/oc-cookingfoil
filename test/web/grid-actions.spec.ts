import { test, expect } from '@playwright/test';
import { signIn } from './admin-sign-in';

// Buttons in an admin table are never cut by their cell: the column grows to hold them and the
// table scrolls sideways instead, with nothing pinned to the right edge.
test('admin table buttons fit their cells on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 900 });
  await signIn(page);
  let checked = 0;
  for (const at of ['#devices', '#users', '/homebrew?tab=apps', '/retro?view=art', '#nsz', '/patches?tab=list', '#logs']) {
    await page.goto('/admin' + at);
    await page.waitForTimeout(900);
    const report = await page.evaluate(() => {
      const cut: string[] = [];
      let buttons = 0;
      for (const mount of document.querySelectorAll('.grid-mount')) {
        if (!(mount as HTMLElement).offsetParent) continue;
        if (mount.querySelector('.ag-pinned-right-cols-container .ag-cell')) cut.push('pinned right');
        for (const b of mount.querySelectorAll('.ag-cell button, .ag-cell a.btn, .ag-cell select')) {
          const cell = b.closest('.ag-cell') as HTMLElement;
          const r = b.getBoundingClientRect(), c = cell.getBoundingClientRect();
          if (!r.width) continue;
          buttons++;
          if (r.left < c.left - 1 || r.right > c.right + 1) cut.push((b.textContent || b.tagName).trim().slice(0, 20));
        }
      }
      return { cut, buttons };
    });
    expect(report.cut, at).toEqual([]);
    checked += report.buttons;
  }
  expect(checked).toBeGreaterThan(0);
});
