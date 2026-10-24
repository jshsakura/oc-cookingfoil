import { test, expect, type Page } from '@playwright/test';
import { signIn } from './admin-sign-in';
import fs from 'node:fs';
import path from 'node:path';

// The retro tab's "what the library needs": BIOS chips go grey, amber, green with the files the
// operator puts in retroarch/system/; cores are a quiet line, since the server supplies them.
// The web server's retro folder (test/web/server.mjs) holds Mega Drive games and Gunbird.

const system = path.join(process.env.COOK_RETRO_DIR!, 'retroarch', 'system');
const placed = path.join(system, 'BIOS_MD.BIN');

async function openRetro(page: Page, lang = 'ko') {
  await page.evaluate((l) => { localStorage.setItem('cookingfoil:lang', l); localStorage.setItem('cf-retro-sub', 'art'); }, lang);
  await page.reload();
  await page.goto('/admin/retro?view=art');
  await expect(page.locator('#ra-bios .rq-note')).toBeVisible();
}

test.afterEach(() => fs.rmSync(placed, { force: true }));

test('an optional BIOS chip turns from grey to amber when a file with its name but another dump appears', async ({ page }) => {
  fs.rmSync(placed, { force: true });
  await signIn(page);
  await openRetro(page);
  const bios = page.locator('#ra-bios');
  await expect(bios.locator('.rq-note')).toContainText('.nro');
  await expect(bios.locator('.rq-ok')).toHaveText('✓ 라이브러리의 게임에 필요한 BIOS 가 모두 있습니다.');
  const done = bios.locator('#rq-done');
  await done.locator('summary').click();
  const chip = done.locator('.rq-card[data-system="md"] .rq-chip', { hasText: 'bios_MD.bin' });
  await expect(chip).toHaveClass(/\bmissing\b/);
  await expect(chip.locator('.rq-opt')).toHaveText('선택');
  await expect(chip).toHaveAttribute('aria-label', 'bios_MD.bin, 없습니다, 선택');

  // Any letter case will do; content that is not the documented dump shows amber, with the state in words.
  fs.mkdirSync(system, { recursive: true });
  fs.writeFileSync(placed, 'not a real bios');
  await openRetro(page);
  await page.locator('#rq-done summary').click();
  const placedChip = page.locator('#rq-done .rq-card[data-system="md"] .rq-chip');
  await expect(placedChip).toHaveClass(/\bmismatch\b/);
  await expect(placedChip).toContainText('BIOS_MD.BIN');
  await expect(placedChip).toHaveAttribute('aria-label', 'BIOS_MD.BIN, 해시가 다릅니다, 선택');
  await page.locator('#ra-bios').screenshot({ path: 'out/web/admin-retro-requirements.png' });
});

const NEEDS = {
  note: 'Cores are Switch .nro files', retroarch: 'installed', complete: false,
  systems: [
    {
      id: 'pcecd', names: { en: 'PC Engine CD', ko: 'PC 엔진 CD', ja: 'PCエンジン CD-ROM²', zh: 'PC Engine CD' }, games: 3, missing: 1,
      cores: [{ core: 'mednafen_pce_fast', file: 'mednafen_pce_fast_libretro_libnx.nro', server: 'retroarch/cores/mednafen_pce_fast_libretro_libnx.nro', console: 'sdmc:/retroarch/cores/mednafen_pce_fast_libretro_libnx.nro', games: 3, state: 'will-install', warn: false }],
      firmware: [{ files: ['syscard3.pce'], required: true, state: 'missing' }],
    },
    {
      id: 'arcade', names: { en: 'Arcade', ko: '아케이드', ja: 'アーケード', zh: '街机' }, games: 4, missing: 2,
      cores: [{ core: 'fbneo', file: 'fbneo_libretro_libnx.nro', server: 'retroarch/cores/fbneo_libretro_libnx.nro', console: 'sdmc:/retroarch/cores/fbneo_libretro_libnx.nro', games: 4, state: 'failed', reason: 'sha256', warn: true }],
      firmware: [],
      arcade: { sets: 4, missingSets: 2, bios: [{ zip: 'neogeo.zip', sets: 2, state: 'missing' }, { zip: 'pgm.zip', sets: 1, state: 'present' }], parents: [{ zip: 'sf2.zip', sets: 1 }] },
    },
    {
      id: 'ps1', names: { en: 'PlayStation', ko: '플레이스테이션', ja: 'プレイステーション', zh: 'PlayStation' }, games: 2, missing: 0,
      cores: [{ core: 'pcsx_rearmed', file: 'pcsx_rearmed_libretro_libnx.nro', server: 'retroarch/cores/pcsx_rearmed_libretro_libnx.nro', console: 'sdmc:/retroarch/cores/pcsx_rearmed_libretro_libnx.nro', games: 2, state: 'present', warn: false }],
      firmware: [{ files: ['scph5501.bin', 'scph1001.bin'], required: false, state: 'present', file: 'psx.bin', recognizedAs: 'scph5501.bin', console: 'retroarch/system/scph5501.bin' }],
    },
  ],
};

test('the needs show in all four languages, missing systems first, a failed core warned, the rest folded', async ({ page }) => {
  await page.route('**/admin/api/retro-art', async (route) => {
    const body = await (await route.fetch()).json();
    await route.fulfill({ json: { ...body, requirements: NEEDS, unread: [], shadowed: [] } });
  });
  await signIn(page);
  const words: Record<string, { nro: RegExp; core: string; parents: string }> = {
    ko: { nro: /PC용 RetroArch/, core: '서버가 자동으로 설치합니다', parents: '부모 세트 1개 없음' },
    en: { nro: /do not work/, core: 'the server installs it automatically', parents: '1 parent sets missing' },
    ja: { nro: /使えません/, core: 'サーバーが自動でインストールします', parents: '親セット 1 件なし' },
    zh: { nro: /无法使用/, core: '服务器会自动安装', parents: '缺少 1 个父集' },
  };
  for (const [lang, w] of Object.entries(words)) {
    await openRetro(page, lang);
    const bios = page.locator('#ra-bios');
    await expect(bios.locator('.rq-note')).toHaveText(w.nro);
    const need = bios.locator('#rq-need .rq-card');
    await expect(need).toHaveCount(2);
    await expect(need.first()).toHaveAttribute('data-system', 'pcecd');
    await expect(need.first().locator('.rq-core')).toContainText(w.core);
    await expect(need.first().locator('.rq-chip')).toHaveClass(/\bmissing\b/);
    await expect(need.first().locator('.rq-hint')).toContainText('retroarch/system/');
    const arcade = need.nth(1);
    await expect(arcade.locator('.rq-chip', { hasText: 'neogeo.zip' })).toHaveClass(/\bmissing\b/);
    await expect(arcade.locator('.rq-chip', { hasText: 'pgm.zip' })).toHaveClass(/\bpresent\b/);
    await expect(arcade.locator('.rq-chip', { hasText: w.parents })).toBeVisible();
    await expect(bios.locator('.warn-line', { hasText: 'fbneo_libretro_libnx.nro' })).toBeVisible();
    await expect(bios.locator('.rq-ok')).toHaveCount(0);
    await expect(bios.locator('#rq-done')).not.toHaveAttribute('open', '');
    await bios.locator('#rq-done summary').click();
    const ps1 = bios.locator('#rq-done .rq-card[data-system="ps1"] .rq-chip');
    await expect(ps1).toHaveClass(/\bpresent\b/);
    await expect(ps1).toContainText('scph5501.bin');
    if (lang !== 'ko') expect(await bios.innerText()).not.toMatch(/[가-힣]/);
    if (lang === 'en') await bios.screenshot({ path: 'out/web/admin-retro-requirements-en.png' });
  }
  // Nothing here offers a firmware or core download.
  await expect(page.locator('#ra-bios a')).toHaveCount(0);
});

const core = (name: string, state: string, extra: Record<string, unknown> = {}) => ({
  core: name, file: `${name}_libretro_libnx.nro`, server: `retroarch/cores/${name}_libretro_libnx.nro`,
  console: `sdmc:/retroarch/cores/${name}_libretro_libnx.nro`, games: 1, state, warn: ['missing', 'not-in-bundle', 'not-in-nightly', 'failed'].includes(state), ...extra,
});
const sys = (id: string, cores: unknown[], rest: Record<string, unknown> = {}) => ({ id, names: { en: id, ko: id, ja: id, zh: id }, games: 1, missing: 0, check: 0, cores,
  // An optional BIOS that is there, so the system's card (and its core line) shows in the folded list.
  firmware: [{ files: ['x.bin'], required: false, state: 'present', file: 'x.bin', console: 'retroarch/system/x.bin' }], ...rest });

test('every core state reads as words, a new one too, and a BIOS of another dump is to check, not missing', async ({ page }) => {
  const states = ['present', 'pinned', 'nightly', 'held', 'installing', 'will-install', 'operator-owned', 'missing', 'not-in-bundle', 'not-in-nightly', 'failed', 'some-new-state'];
  const needs = {
    note: 'Cores are Switch .nro files', retroarch: 'installed', complete: false,
    systems: [
      sys('pcecd', [core('mednafen_pce_fast', 'present')], { check: 1, firmware: [{ files: ['syscard3.pce'], required: true, state: 'mismatch', file: 'syscard3.pce', console: 'retroarch/system/syscard3.pce', md5: { expected: ['0'], actual: '1' } }] }),
      ...states.map((state, i) => sys(`s${i}`, [core(`c${i}`, state, state === 'failed' ? { reason: 'download', message: 'HTTP 500' } : state === 'missing' ? { reason: 'a-code-nobody-knows' } : {})])),
    ],
  };
  await page.route('**/admin/api/retro-art', async (route) => {
    const body = await (await route.fetch()).json();
    await route.fulfill({ json: { ...body, requirements: needs, unread: [], shadowed: [] } });
  });
  await signIn(page);
  for (const lang of ['ko', 'en', 'ja', 'zh']) {
    await openRetro(page, lang);
    const bios = page.locator('#ra-bios');
    await bios.locator('#rq-done summary').click();
    const text = await bios.innerText();
    expect(text).not.toMatch(/\b(cs|reason)\.[a-z-]+/);
    expect(text).toContain('some-new-state');
    const pce = bios.locator('#rq-need .rq-card[data-system="pcecd"]');
    await expect(pce).toHaveClass(/\bcheck\b/);
    await expect(pce).not.toHaveClass(/\bneed\b/);
    await expect(pce.locator('.rq-chip')).toHaveClass(/\bmismatch\b/);
    await expect(bios.locator('.warn-line', { hasText: 'c8_libretro_libnx.nro' })).toBeVisible();
    await expect(bios.locator('.warn-line', { hasText: 'c9_libretro_libnx.nro' })).toBeVisible();
    await expect(bios.locator('.warn-line', { hasText: 'c10_libretro_libnx.nro' })).toHaveAttribute('title', 'HTTP 500');
    await expect(bios.locator('.warn-line', { hasText: 'c10_libretro_libnx.nro' })).not.toHaveText(/\.\s*download$/);
    await expect(bios.locator('.warn-line', { hasText: 'c1_libretro_libnx.nro' })).toHaveCount(0);
  }
  await openRetro(page, 'ko');
  await expect(page.locator('#rq-need .rq-card[data-system="pcecd"] .rq-tag')).toHaveText('다른 덤프');
  await expect(page.locator('.warn-line', { hasText: 'c10_libretro_libnx.nro' })).toContainText('내려받지 못했습니다.');
});
