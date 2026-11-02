import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { signIn } from './admin-sign-in';

// 제안: a finding says what was found and why; a drop shows its files first and the notice takes it back; a kept one goes away.
const retro = () => process.env.COOK_RETRO_DIR!;
const at = (rel: string) => path.join(retro(), ...rel.split('/'));
const put = (rel: string, body = 'x') => { fs.mkdirSync(path.dirname(at(rel)), { recursive: true }); fs.writeFileSync(at(rel), body); };
const FILES = ['roms/ps1/Sg Lone.bin', 'roms/ps1/Sg Broken.cue'];

test.afterEach(() => { for (const rel of FILES) fs.rmSync(at(rel), { force: true }); });

test('제안 lists a lone disc file and a broken disc list; a drop goes to the trash and comes back, a kept one goes away', async ({ page }) => {
  put('roms/ps1/Sg Lone.bin');
  put('roms/ps1/Sg Broken.cue', 'FILE "Sg Broken.bin" BINARY\n');
  await signIn(page);
  await page.goto('/admin/games?view=suggest#library/suggest');
  const lone = page.locator('#sg-list .sg-item', { hasText: 'roms/ps1/Sg Lone.bin' });
  await expect(lone.locator('h3')).toHaveText('짝 없는 디스크 파일입니다');
  await expect(lone).toContainText('Sg Lone.bin 을 가리키는 .cue 나 .m3u 가 없어');
  await lone.getByRole('button', { name: 'bin 버리기' }).click();
  await expect(page.locator('#ask-dialog')).toContainText('roms/ps1/Sg Lone.bin');
  await page.locator('#ask-ok').click();
  await expect.poll(() => fs.existsSync(at('roms/ps1/Sg Lone.bin'))).toBe(false);
  await expect(lone).toHaveCount(0);
  await page.locator('#toast .toast-act').click();
  await expect.poll(() => fs.existsSync(at('roms/ps1/Sg Lone.bin'))).toBe(true);

  const broken = page.locator('#sg-list .sg-item', { hasText: 'roms/ps1/Sg Broken.cue' }).filter({ has: page.locator('h3', { hasText: '디스크 목록이 가리키는 파일이 없습니다' }) });
  await expect(broken).toContainText('같은 폴더에 없어 실행되지 않습니다: Sg Broken.bin');
  await expect(broken.getByRole('button', { name: /버리기/ })).toHaveCount(0);
  await broken.getByRole('button', { name: '그대로 두기' }).click();
  await expect(broken).toHaveCount(0);
  await page.reload();
  await expect(broken).toHaveCount(0);
  await expect(page.locator('#sg-state')).toContainText('그대로 두기로 한 제안');
  expect(fs.existsSync(at('roms/ps1/Sg Broken.cue'))).toBe(true);
});
