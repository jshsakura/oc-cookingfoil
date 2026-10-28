import { test, expect, type Page } from '@playwright/test';
import { signIn } from './admin-sign-in';

// One thing, one name: a page's heading reads like the sidebar item that opens it, a tab's section heading
// reads like the tab, and the header breadcrumb ends with the tab that is open.

// The visible words of an element, counts and icons left out.
const words = (e: Element) => { const c = e.cloneNode(true) as Element; c.querySelectorAll('.count,svg').forEach((n) => n.remove()); return (c.textContent ?? '').replace(/\s+/g, ' ').trim(); };
const text = (loc: ReturnType<Page['locator']>) => loc.first().evaluate(words);

// Pages whose heading is not renamed yet: the owner has not given the new word.
const PENDING = new Set(['/admin', '/admin/settings/login', '/admin/settings/admin']);
// Pages that hold their jobs as tabs and have no heading of their own: only the tab headings are checked.
const TABS_ONLY = new Set(['/admin/retro', '/admin/homebrew']);

async function pickLang(page: Page, lang: string) {
  await page.locator('#lang-btn').click();
  await page.locator(`#lang-list [data-admin-lang="${lang}"]`).click();
}

async function pagePaths(page: Page): Promise<string[]> {
  await page.goto('/admin');
  const side = await page.locator('aside.adm-side > nav a.adm-item').evaluateAll((as) => as.map((a) => a.getAttribute('href')!));
  await page.goto('/admin/upload');
  const rows = await page.locator('.adm-rowtabs a').evaluateAll((as) => as.map((a) => a.getAttribute('href')!));
  return [...new Set([...side, ...rows])];
}

for (const lang of ['ko', 'en']) {
  test(`every page and tab is named like what opens it (${lang})`, async ({ page }) => {
    test.setTimeout(240_000);
    await signIn(page);
    await page.goto('/admin');
    if (lang !== 'ko') await pickLang(page, lang);
    const problems: string[] = [];
    for (const path of await pagePaths(page)) {
      await page.goto(path);
      await expect(page.locator('#adm-crumb .adm-crumb-i')).toBeVisible();
      const rowTab = page.locator('.adm-rowtabs [aria-current="page"]');
      const label = await text((await rowTab.count()) ? rowTab : page.locator('aside.adm-side > nav a[aria-current="page"]'));
      const h2s = await page.locator('main h2, .wrap h2').evaluateAll((hs) => hs.filter((h) => (h as HTMLElement).offsetParent).map((h) => (h.textContent ?? '').replace(/\s+/g, ' ').trim()));
      if (h2s.length && !PENDING.has(path) && !TABS_ONLY.has(path) && !h2s.includes(label)) problems.push(`${path}: heading ${JSON.stringify(h2s.slice(0, 2))} vs menu ${JSON.stringify(label)}`);
      const tabs = page.locator('.wrap .subtabs:not(.adm-rowtabs) :is([data-sub],[data-lsub]):visible');
      const n = await tabs.count();
      for (let i = 0; i < n; i++) {
        const tab = tabs.nth(i);
        const name = await text(tab);
        await tab.click();
        const key = await tab.evaluate((t) => (t as HTMLElement).dataset.sub ?? (t as HTMLElement).dataset.lsub ?? '');
        if (key) {
          const panel = page.locator(`[data-sub-panel="${key}"], [data-lib-panel="${key}"]`).first();
          if (await panel.count()) {
            const h = panel.locator('h2:visible').first();
            if (await h.count()) {
              const got = await text(h);
              if (got !== name && got !== label) problems.push(`${path} tab ${key}: heading ${JSON.stringify(got)} vs tab ${JSON.stringify(name)}`);
            }
          }
        }
        const last = await text(page.locator('#adm-crumb > :last-child'));
        if (last !== name) problems.push(`${path} tab ${key}: crumb ends ${JSON.stringify(last)} vs tab ${JSON.stringify(name)}`);
      }
    }
    expect(problems).toEqual([]);
  });
}
