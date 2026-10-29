import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { shot } from './shots';

const NAME = 'G-MODEアーカイブス+ 探偵 テスト';
const LONG = 'G-MODEアーカイブス+ 探偵・神宮寺三郎 ダミーの長い題名 テスト用';

// Cards built from the page's own classes: a name that is one unbreakable run of kana
// must fill the line and be cut at the edge, not shrink to "G-" plus an ellipsis.
async function mountCards(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.evaluate(({ name, long }) => {
    const card = (n: string) => `<div class="game"><div class="poster"><div class="cover"></div></div><div class="meta"><div class="name" title="${n}">${n}</div></div></div>`;
    const host = document.createElement('div');
    host.id = 'ellipsis-probe';
    host.innerHTML = `<div class="recent" style="--card:140px;display:grid;grid-auto-flow:column;grid-auto-columns:var(--card)">${card(long)}</div>`
      + `<div class="grid" style="--card:140px;display:grid;grid-template-columns:repeat(auto-fill,var(--card))">${card(name)}</div>`;
    document.body.prepend(host);
  }, { name: NAME, long: LONG });
}

// Width of the first rendered line of the name text, measured with a Range.
const firstLineWidth = (page: import('@playwright/test').Page, selector: string) => page.evaluate((sel) => {
  const el = document.querySelector(sel) as HTMLElement;
  const text = el.firstChild as Text;
  const range = document.createRange();
  range.setStart(text, 0);
  range.setEnd(text, 1);
  const top = range.getClientRects()[0].top;
  let right = 0;
  for (let i = 1; i <= text.length; i++) {
    range.setEnd(text, i);
    const rects = [...range.getClientRects()].filter((r) => Math.abs(r.top - top) < 2);
    for (const r of rects) right = Math.max(right, r.right);
  }
  return { used: right - el.getBoundingClientRect().left, box: el.clientWidth };
}, selector);

test('a one-line card name of unbroken kana fills the line instead of showing "G-"', async ({ page }) => {
  await mountCards(page);
  fs.mkdirSync('out/web', { recursive: true });
  await shot(page.locator('#ellipsis-probe'), { path: 'out/web/card-name-ellipsis.png' });
  const name = page.locator('#ellipsis-probe .recent .name');
  const { used, box } = await firstLineWidth(page, '#ellipsis-probe .recent .name');
  expect(used).toBeGreaterThan(box * 0.7);
  const clipped = await name.evaluate((el) => el.scrollWidth > el.clientWidth);
  expect(clipped).toBe(true);
});

test('a two-line card name breaks inside kana, so the first line is not just "G-"', async ({ page }) => {
  await mountCards(page);
  const { used, box } = await firstLineWidth(page, '#ellipsis-probe .grid .name');
  expect(used).toBeGreaterThan(box * 0.7);
});
