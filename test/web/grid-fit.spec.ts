import { expect, test } from '@playwright/test';
import { signIn } from './admin-sign-in';

// Short pills take the measured-width path (a column whose text fits in 28 characters). Columns of pills and of buttons are as wide as what they hold: the last pill or button is never cut.
test('pill and button columns fit their contents', async ({ page }) => {
  await signIn(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/admin');
  await page.evaluate(() => {
    const w = window as any;
    const d = document.createElement('div');
    d.id = 'fit-probe';
    document.querySelector('#tab-overview')!.prepend(d);
    const rows = Array.from({ length: 6 }, (_, i) => {
      const tr = document.createElement('tr');
      const tags = document.createElement('td');
      tags.append(w.pill('Set ' + i), w.pill('KOR'), w.pill('Rev 1'));
      const acts = document.createElement('td');
      const box = w.el('div', null, 'row-actions');
      box.append(w.btn('Make this the pick', () => {}), w.tbtn('delete', 'pp.delete', () => {}, 'danger'));
      acts.append(box);
      const name = document.createElement('td');
      name.textContent = 'A game with a fairly long name number ' + i;
      tr.append(name, tags, acts);
      return tr;
    });
    w.table('fit-probe', ['name', 'tags', ''], rows, 'none');
  });
  const grid = page.locator('#fit-probe');
  await expect(grid.locator('.ag-row').first()).toBeVisible();
  const cut = await grid.evaluate((root) => {
    const bad: string[] = [];
    for (const cell of root.querySelectorAll('.ag-cell')) {
      const edge = cell.getBoundingClientRect().right;
      for (const n of cell.querySelectorAll('.pill, button')) {
        if (n.getBoundingClientRect().right > edge + 0.5) bad.push(n.textContent || n.getAttribute('aria-label') || '?');
      }
    }
    return bad;
  });
  expect(cut).toEqual([]);
});
