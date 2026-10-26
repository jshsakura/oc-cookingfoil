import { test, expect } from '@playwright/test';
import { signIn } from './admin-sign-in';
import fs from 'node:fs';
import path from 'node:path';

// The plugins page against the real server: a plugin put into data/plugins shows up after a rescan, off;
// the person switches it on and off, deletes it (into the plugins' own trash) and brings it back.
const DIR = path.join(process.env.COOK_DATA_DIR!, 'plugins');
const ID = 'web-spec-plugin';
const manifest = { id: ID, apiVersion: 1, version: '1.2.3', name: { en: 'Web spec plugin', ko: '웹 시험 플러그인' }, provides: ['metadata'] };

test.beforeEach(() => {
  fs.mkdirSync(path.join(DIR, ID), { recursive: true });
  fs.writeFileSync(path.join(DIR, ID, 'plugin.json'), JSON.stringify(manifest));
  fs.writeFileSync(path.join(DIR, ID, 'index.js'), 'export default { async metadata() { return {}; } };');
});
test.afterEach(async ({ page }) => {
  fs.rmSync(path.join(DIR, ID), { recursive: true, force: true });
  await page.request.post('/admin/api/plugins/rescan', { data: {} }).catch(() => {});
});

test('a new plugin is listed off, switches on and off, is deleted into the trash and comes back off', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin/settings/plugins');
  await page.locator('#pl-rescan').click();
  const row = page.locator('#pl-list .pl-row', { hasText: ID });
  await expect(row).toBeVisible();
  await expect(row).toContainText('꺼짐');
  await expect(row).toContainText('웹 시험 플러그인');
  await expect(row).toContainText('버전 1.2.3');

  await row.getByRole('button', { name: '켜기' }).click();
  await expect(page.locator('#toast')).toContainText('켰습니다');
  await expect(row).toContainText('켜짐');
  await row.getByRole('button', { name: '끄기' }).click();
  await expect(row).toContainText('꺼짐');

  await row.getByRole('button', { name: '삭제' }).click();
  await expect(page.locator('#ask-text')).toContainText('휴지통으로 옮기므로 되돌릴 수 있습니다');
  await page.locator('#ask-ok').click();
  await expect(page.locator('#ask-text')).toContainText('캐시와 설정도 함께 지울까요?');
  await page.locator('#ask-no').click();
  await expect(page.locator('#toast')).toContainText('휴지통으로 옮겼습니다');
  await expect(row).toHaveCount(0);
  expect(fs.existsSync(path.join(DIR, ID))).toBe(false);
  const trashed = page.locator('#pl-trashed .pl-row', { hasText: ID });
  await expect(trashed).toBeVisible();
  await trashed.getByRole('button', { name: '되돌리기' }).click();
  await expect(page.locator('#toast')).toContainText('되돌렸습니다');
  await expect(page.locator('#pl-list .pl-row', { hasText: ID })).toContainText('꺼짐');
  expect(fs.existsSync(path.join(DIR, ID, 'index.js'))).toBe(true);
});

test('the plugins page speaks the language the top area is set to', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin/settings/plugins');
  await page.locator('#lang-btn').click();
  await page.locator('[data-admin-lang="en"]').click();
  await expect(page.locator('#pl-rescan')).toHaveText('Scan again');
  await page.locator('#pl-rescan').click();
  await expect(page.locator('#pl-list .pl-row', { hasText: ID })).toContainText('Off');
});
