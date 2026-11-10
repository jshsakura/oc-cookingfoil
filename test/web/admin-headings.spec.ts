import { test, expect, type Page } from '@playwright/test';
import { signIn } from './admin-sign-in';

// One thing, one name: the header breadcrumb (the page's title since the headings left the pages) names
// the menu item or tab that opens the page, a tab's section heading reads like the tab, and the breadcrumb
// ends with the tab that is open.

// The visible words of an element, counts and icons left out.
const words = (e: Element) => { const c = e.cloneNode(true) as Element; c.querySelectorAll('.count,svg').forEach((n) => n.remove()); return (c.textContent ?? '').replace(/\s+/g, ' ').trim(); };
const text = (loc: ReturnType<Page['locator']>) => loc.first().evaluate(words);


async function pickLang(page: Page, lang: string) {
  await page.locator('#lang-btn').click();
  await page.locator(`#lang-list [data-admin-lang="${lang}"]`).click();
}

async function pagePaths(page: Page): Promise<string[]> {
  await page.goto('/admin');
  const side = await page.locator('aside.adm-side > nav a.adm-item').evaluateAll((as) => as.map((a) => a.getAttribute('href')!));
  const rows: string[] = [];
  for (const path of side) {
    await page.goto(path);
    rows.push(...await page.locator('.adm-rowtabs a').evaluateAll((as) => as.map((a) => a.getAttribute('href')!)));
  }
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
      const crumb = await text(page.locator('#adm-crumb'));
      if (!crumb.includes(label)) problems.push(`${path}: crumb ${JSON.stringify(crumb)} vs menu ${JSON.stringify(label)}`);
      // The holding area's temp folder tabs sit under that part's own heading and leave the crumb alone.
      const tabs = page.locator('.wrap .subtabs:not(.adm-rowtabs):not(.inc-sub) :is([data-sub],[data-lsub]):visible');
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
