import { test, expect } from '@playwright/test';
import { signIn } from './admin-sign-in';

// The page is the one thing that scrolls up and down. A tab row or a panel that scrolls on its own
// moves a pixel under the wheel before the page does, which reads as a broken page.
const PAGES = ['/admin', '/admin/games', '/admin/retro', '/admin/homebrew', '/admin/users', '/admin/devices', '/admin/logs/downloads', '/admin/logs/clients'];

for (const width of [390, 1366]) {
  test(`only the page scrolls vertically at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await signIn(page);
    for (const path of PAGES) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const scrollers = await page.evaluate(() => Array.from(document.querySelectorAll('body *'))
        .filter((e) => /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight)
        // Dialogs, the menus and the grid's own body are allowed their own scroll.
        .filter((e) => !(e as HTMLElement).closest('dialog, aside, .adm-drawer, .ag-root-wrapper'))
        .map((e) => e.id || e.className.toString()));
      expect(scrollers, path).toEqual([]);
    }
  });
}
