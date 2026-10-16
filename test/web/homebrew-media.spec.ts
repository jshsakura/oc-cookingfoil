import { test, expect, type Page } from '@playwright/test';
import { generate } from 'otplib';
import sharp from 'sharp';
import fs from 'node:fs';

// A homebrew app's window laid out as a game's: the banner behind its header,
// screenshots under its description. It opens at its top, keeps the page behind
// it still, and gives a touch screen no focus.
const SECRET = 'KRSXG5CTMVRXEZLUKRSXG5CTMVRXEZLU';
const png = (w: number, h: number, r: number, g: number, b: number) => sharp({ create: { width: w, height: h, channels: 3, background: { r, g, b } } }).png().toBuffer();

async function signIn(page: Page) {
  await page.goto('/admin?enrolled=1');
  await page.getByLabel('인증 앱 코드').fill(await generate({ secret: SECRET }));
  await page.getByRole('button', { name: '들어가기', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'CookingFoil 관리', exact: true })).toBeVisible();
}

test('an app with pictures opens like a game, and the page behind stays put', async ({ page, browser }) => {
  await signIn(page);
  const origin = new URL(page.url()).origin;
  const { apps } = await (await page.request.get('/admin/api/homebrew/apps')).json();
  const app = apps.find((a: { name: string }) => a.name === 'Hand App');
  expect(app).toBeTruthy();
  const up = async (path: string, body: Buffer) => {
    const r = await page.request.post(`${path}?id=${app.id}`, { data: body, headers: { 'Content-Type': 'image/png', Origin: origin } });
    expect(r.status(), await r.text()).toBe(200);
  };
  await up('/admin/api/homebrew/banner/upload', await png(1920, 620, 40, 90, 160));
  for (const c of [[200, 60, 60], [60, 160, 90], [90, 90, 200]]) await up('/admin/api/homebrew/shots/upload', await png(1280, 720, c[0], c[1], c[2]));
  const after = (await (await page.request.get('/admin/api/homebrew/apps')).json()).apps.find((a: { id: string }) => a.id === app.id);
  expect(after.banner_url).toMatch(/\/banner\?v=/);
  expect(after.screenshots).toHaveLength(3);
  expect(after.media).toEqual({ banner: 'upload', shots: 'upload' });
  // A console that cannot read WebP gets the same pictures as JPEG; browsers get WebP.
  for (const url of [after.banner_url, after.screenshots[0]]) {
    const jpg = await page.request.get(url, { headers: { Accept: 'image/jpeg,*/*' } });
    expect(jpg.headers()['content-type']).toBe('image/jpeg');
    expect((await jpg.body()).subarray(0, 2).toString('hex')).toBe('ffd8');
    const webp = await page.request.get(url, { headers: { Accept: 'image/webp,*/*' } });
    expect(webp.headers()['content-type']).toBe('image/webp');
    expect(webp.headers()['cache-control']).toContain('immutable');
    expect(webp.headers().vary).toContain('Accept');
  }
  fs.mkdirSync('out/web', { recursive: true });

  for (const [label, viewport, touch] of [['phone', { width: 390, height: 844 }, true], ['desktop', { width: 1280, height: 900 }, false]] as const) {
    const ctx = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch, storageState: await page.context().storageState() });
    const p = await ctx.newPage();
    await p.addInitScript(() => { try { localStorage.setItem('cookingfoil:lang', 'ko'); } catch { /* none */ } });
    await p.goto('/#tools');
    const row = p.locator('#tools-list .xrow', { hasText: 'Hand App' });
    await expect(row).toBeVisible();
    // The page is scrolled a little before the window opens, so a jump would show.
    await p.evaluate(() => window.scrollTo(0, 120));
    const before = await p.evaluate(() => window.scrollY);
    await row.click();
    const modal = p.locator('#xmodal .modal');
    await expect(modal).toHaveClass(/has-banner/);
    await expect(p.locator('#xm-banner')).toBeVisible();
    await expect(p.locator('#xm-screens img')).toHaveCount(3);
    const state = await p.evaluate(() => ({
      top: (document.querySelector('#xmodal .modal-scroll') as HTMLElement).scrollTop,
      pinned: document.documentElement.classList.contains('sheet-open'),
      focus: document.activeElement?.id || document.activeElement?.className || '',
      shadow: getComputedStyle(document.querySelector('#xmodal .modal-head') as Element).boxShadow,
    }));
    expect(state.top, 'opens at its top').toBe(0);
    expect(state.pinned, 'the page behind is pinned').toBe(true);
    expect(state.focus).not.toBe('xm-close');
    if (touch) expect(state.focus, 'a touch screen gets no focus').not.toContain('modal-x');
    expect(state.shadow, 'no head band over the banner').toBe('none');
    // The title reads below the banner; an icon, when the app has one, sits over its lower edge.
    const band = (await p.locator('#xm-banner').boundingBox())!;
    const titleBox = (await p.locator('#xm-title').boundingBox())!;
    expect(titleBox.y).toBeGreaterThanOrEqual(band.y + band.height);
    const icon = await p.locator('#xm-icon').boundingBox();
    if (icon) {
      expect(icon.y).toBeLessThan(band.y + band.height);
      expect(icon.y + icon.height).toBeGreaterThan(band.y + band.height);
    }
    // After the window's rise animation, so the picture is of what stays on screen.
    await p.waitForTimeout(700);
    await p.screenshot({ path: `out/web/homebrew-media-${label}.png` });
    // An app with an icon, in the dark theme: the icon sits over the banner's lower edge.
    await p.evaluate(() => {
      document.documentElement.dataset.theme = 'dark';
      const c = document.createElement('canvas'); c.width = c.height = 256;
      const g = c.getContext('2d')!; g.fillStyle = '#e8b13a'; g.fillRect(0, 0, 256, 256);
      const img = document.getElementById('xm-icon') as HTMLImageElement; img.onerror = null; img.hidden = false; img.src = c.toDataURL();
    });
    await expect(p.locator('#xm-icon')).toBeVisible();
    const b2 = (await p.locator('#xm-banner').boundingBox())!;
    const i2 = (await p.locator('#xm-icon').boundingBox())!;
    expect(i2.y).toBeLessThan(b2.y + b2.height);
    expect(i2.y + i2.height).toBeGreaterThan(b2.y + b2.height);
    await p.screenshot({ path: `out/web/homebrew-media-${label}-icon.png` });
    await p.locator('#xmodal .modal-x').click();
    await expect(p.locator('#xmodal')).not.toHaveClass(/open/);
    expect(await p.evaluate(() => document.documentElement.classList.contains('sheet-open'))).toBe(false);
    expect(await p.evaluate(() => window.scrollY), 'back where it was').toBe(before);
    await ctx.close();
  }

  // Removing them brings back today's plain header.
  for (const [path, body] of [['/admin/api/homebrew/banner/remove', { id: app.id }], ['/admin/api/homebrew/shots/remove', { id: app.id }]] as const) {
    expect((await page.request.post(path, { data: body, headers: { Origin: origin } })).status()).toBe(200);
  }
  await page.goto('/#tools');
  await page.locator('#tools-list .xrow', { hasText: 'Hand App' }).click();
  await expect(page.locator('#xm-banner')).toBeHidden();
  await expect(page.locator('#xmodal .modal')).not.toHaveClass(/has-banner/);
  await expect(page.locator('#xm-screens img')).toHaveCount(0);
});
