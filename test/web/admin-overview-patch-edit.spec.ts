import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import { signIn } from './admin-sign-in';

const settled = (page: Page) => page.locator('#ct-edit').evaluate((d) => Promise.all(d.getAnimations({ subtree: true }).map((a) => a.finished)));
const row = (page: Page, name: string) => page.locator('#ov-added-patches li', { hasText: name });

async function rename(page: Page, from: string, to: string, author?: string) {
  await row(page, from).getByRole('button', { name: `${from} 편집` }).click();
  const dialog = page.locator('#ct-edit');
  await expect(dialog).toBeVisible();
  await expect(page.locator('#ct-name')).toHaveValue(from);
  await page.locator('#ct-name').fill(to);
  if (author !== undefined) await page.locator('#ct-author').fill(author);
  await dialog.getByRole('button', { name: '저장', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(row(page, to)).toBeVisible();
}

test('a patch added lately is renamed from the overview with the patch dialog, and its other fields stay', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page);
  await page.goto('/admin');
  await expect(row(page, '한글패치')).toBeVisible();
  const author = async (name: string) => ((await (await request.get('/api/patches?lang=en')).json()).patches as
    { author: string | null; name: string }[]).find((p) => p.name === name)?.author;

  await row(page, '한글패치').getByRole('button', { name: '한글패치 편집' }).click();
  await settled(page);
  fs.mkdirSync('out/web', { recursive: true });
  await page.screenshot({ path: 'out/web/admin-overview-patch-edit-1280.png' });
  await page.locator('#ct-close').click();

  await rename(page, '한글패치', 'Hangul patch', 'Someone');
  await expect(row(page, '한글패치')).toHaveCount(0);
  expect(await author('Hangul patch')).toBe('Someone');
  // The dialog opened from the overview starts from the saved fields, so a rename alone keeps the author.
  await rename(page, 'Hangul patch', '한글패치');
  expect(await author('한글패치')).toBe('Someone');
  await rename(page, '한글패치', '한글패치', '');
});

test('on a phone the overview with its patch dialog open has no sideways scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await page.goto('/admin');
  const r = row(page, '한글패치');
  await expect(r.locator('.pt-edit')).toBeVisible();
  const [li, edit] = await Promise.all([r.boundingBox(), r.locator('.pt-edit').boundingBox()]);
  expect(edit!.x + edit!.width).toBeLessThanOrEqual(li!.x + li!.width);
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(await overflow()).toBeLessThanOrEqual(0);
  await r.getByRole('button', { name: '한글패치 편집' }).click();
  await expect(page.locator('#ct-edit')).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(0);
  await settled(page);
  fs.mkdirSync('out/web', { recursive: true });
  await page.screenshot({ path: 'out/web/admin-overview-patch-edit-390.png' });
});
