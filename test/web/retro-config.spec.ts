import { test, expect, type Page } from '@playwright/test';
import { signIn } from './admin-sign-in';
import { acceptAsks } from './ask';
import fs from 'node:fs';
import path from 'node:path';

// The retro tab's RetroArch settings, read in the order RetroArch reads its files. One installed core
// (ScummVM) is faked in the web server's retro folder; every file the page writes lands under config/.

const pack = path.join(process.env.COOK_RETRO_DIR!, 'retroarch');
const nro = path.join(pack, 'cores', 'scummvm_libretro_libnx.nro');
const info = path.join(pack, 'info', 'scummvm_libretro.info');
const override = path.join(pack, 'config', 'ScummVM', 'ScummVM.cfg');
const global = path.join(pack, 'retroarch.cfg');
let globalBefore: string | null = null;

test.beforeEach(() => {
  globalBefore = fs.existsSync(global) ? fs.readFileSync(global, 'utf8') : null;
  fs.mkdirSync(path.dirname(nro), { recursive: true });
  fs.mkdirSync(path.dirname(info), { recursive: true });
  fs.writeFileSync(nro, 'not a real core');
  fs.writeFileSync(info, 'corename = "ScummVM"\ndisplay_name = "ScummVM"\n');
});

test.afterEach(() => {
  fs.rmSync(nro, { force: true });
  fs.rmSync(info, { force: true });
  fs.rmSync(path.join(pack, 'config'), { recursive: true, force: true });
  if (globalBefore === null) fs.rmSync(global, { force: true }); else fs.writeFileSync(global, globalBefore);
});

// A setting's row, with its RetroArch menu group unfolded the way a person opens it.
async function settingRow(page: Page, key: string) {
  const row = page.locator('#rcf-body .rcf-row', { has: page.locator('code', { hasText: new RegExp(`^${key}$`) }) }).first();
  const fold = row.locator('xpath=ancestor::details[1]');
  if (!(await fold.evaluate((d) => (d as HTMLDetailsElement).open))) await fold.locator('summary').click();
  return row;
}

async function openSettings(page: Page) {
  await page.goto('/admin/retro');
  await page.locator('[data-sub="raconf"]').click();
  await expect(page.locator('#rcf-advice')).not.toBeEmpty();
}

test('a recommended line goes in with one click, can be undone from its notice, and the history keeps both', async ({ page }) => {
  await signIn(page);
  await acceptAsks(page);
  await openSettings(page);

  const advice = page.locator('#rcf-advice');
  await expect(advice).toContainText('ScummVM');
  await advice.getByRole('button', { name: '적용' }).click();
  await expect(page.locator('#toast')).toContainText('저장했습니다');
  await expect(advice).toContainText('추천하는 설정이 모두 들어가 있습니다.');
  expect(fs.readFileSync(override, 'utf8')).toBe('video_threaded = "false"\n');

  await page.locator('#toast').getByRole('button', { name: '되돌리기' }).click();
  await expect(page.locator('#toast')).toContainText('되돌렸습니다');
  await expect(advice.getByRole('button', { name: '적용' })).toBeVisible();
  expect(fs.existsSync(override)).toBe(false);

  await page.locator('[data-rcf="history"]').click();
  await expect(page.locator('.rcf-hist li')).toHaveCount(2);
});

test('a core setting left empty says it follows the global value, and each setting names its console menu', async ({ page }) => {
  await signIn(page);
  await openSettings(page);
  await expect(page.locator('#rcf-body')).toContainText('기기 메뉴: Settings > Video > Threaded Video');

  await page.locator('[data-rcf="core"]').click();
  const threaded = await settingRow(page, 'video_threaded');
  await expect(threaded.locator('select option').first()).toContainText('전체 설정 따름');

  await threaded.locator('select').selectOption('false');
  await expect(page.locator('#toast')).toContainText('저장했습니다');
  expect(fs.readFileSync(override, 'utf8')).toBe('video_threaded = "false"\n');
  await expect(page.locator('#rcf-body .rcf-row[data-set]').first()).toBeVisible();
});

test('a global setting spreads into every core override as one change that undoes in one click', async ({ page }) => {
  await signIn(page);
  await acceptAsks(page);
  await openSettings(page);
  const row = await settingRow(page, 'fps_show');
  await row.locator('select').selectOption('true');
  await expect(page.locator('#toast')).toContainText('저장했습니다');
  await row.getByRole('button', { name: '모든 기기에' }).click();
  await expect(page.locator('#toast')).toContainText('코어 1개에 넣었습니다');
  expect(fs.readFileSync(override, 'utf8')).toBe('fps_show = "true"\n');
  await page.locator('#toast').getByRole('button', { name: '되돌리기' }).click();
  await expect(page.locator('#toast')).toContainText('되돌렸습니다');
  expect(fs.existsSync(override)).toBe(false);
});
