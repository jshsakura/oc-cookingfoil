import { test, expect } from '@playwright/test';
import { signIn } from './admin-sign-in';
import fs from 'node:fs';
import path from 'node:path';
// @ts-expect-error a plain ES module shared with the unit tests
import { zip as buildZip } from '../support/zip-builder.js';

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
  // This server has no account or admin password to repeat, so the dialog lists what the plugin asks for and asks once.
  await expect(page.locator('#ask-text')).toContainText('요구하는 것');
  await expect(page.locator('#ask-input')).toBeHidden();
  await page.locator('#ask-ok').click();
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

test('a plugin zip is checked, shown with what it asks for, installed switched off, and then listed as uploaded', async ({ page }) => {
  const id = 'web-spec-upload';
  const zip = buildZip([
    { name: 'plugin.json', data: JSON.stringify({ id, apiVersion: 1, version: '2.0.1', name: { en: 'Uploaded one', ko: '올린 플러그인' }, provides: ['metadata'], needsKeys: true, hosts: ['example.com'] }) },
    { name: 'index.js', data: 'export default { async metadata() { return {}; } };' },
  ]);
  try {
    await signIn(page);
    await page.goto('/admin/settings/plugins');
    await expect(page.locator('#pl-install-btn')).toBeEnabled();
    await page.locator('#pl-install-file').setInputFiles({ name: 'p.zip', mimeType: 'application/zip', buffer: zip });
    await expect(page.locator('#ask-text')).toContainText('올린 플러그인 (' + id + ') 2.0.1');
    await expect(page.locator('#ask-text')).toContainText('prod.keys');
    await expect(page.locator('#ask-text')).toContainText('example.com');
    await page.locator('#ask-ok').click();
    await expect(page.locator('#toast')).toContainText('꺼진 채로');
    const row = page.locator('#pl-list .pl-row', { hasText: id });
    await expect(row).toContainText('꺼짐');
    await expect(row).toContainText('관리 화면에서 설치함');
    expect(fs.existsSync(path.join(DIR, id, 'index.js'))).toBe(true);

    await page.locator('#pl-install-file').setInputFiles({ name: 'bad.zip', mimeType: 'application/zip', buffer: Buffer.from('not a zip') });
    await expect(page.locator('#toast')).toContainText('설치하지 못했습니다');
  } finally {
    fs.rmSync(path.join(DIR, id), { recursive: true, force: true });
    fs.rmSync(path.join(process.env.COOK_DATA_DIR!, 'plugin-origin'), { recursive: true, force: true });
    await page.request.post('/admin/api/plugins/rescan', { data: {} }).catch(() => {});
  }
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
