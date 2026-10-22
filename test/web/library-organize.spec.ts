import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { signIn } from './admin-sign-in';

const GAMES = process.env.COOK_GAMES_DIR!;
const put = (rel: string, old: boolean) => {
  const abs = path.join(GAMES, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, rel);
  if (old) fs.utimesSync(abs, new Date(Date.now() - 10 * 60_000), new Date(Date.now() - 10 * 60_000));
};

test('files dropped in games/incoming are sorted into the games folder, the rest stays with why', async ({ page }) => {
  put('incoming/받은 것/Drop Game [0100000000020000][v0].nsp', true);
  put('incoming/notes.txt', true);
  put('incoming/gba/Drop Quest.gba', true);
  put('incoming/Loose Quest.gba', true);
  put('incoming/fresh [0100000000030000][v0].nsp', false);
  try {
    await signIn(page);
    await page.goto('/admin#library/organize');
    await page.locator('#lo-sweep').click();
    await expect(page.locator('#toast')).toContainText('2개 옮겼습니다');
    await expect(page.locator('#lo-recent')).toContainText('Drop Game/Drop Game [0100000000020000][v0].nsp');
    await expect(page.locator('#lo-held')).toContainText('어디로 보낼지 모르는 파일입니다');
    await expect(page.locator('#lo-recent')).toContainText('roms/gba/Drop Quest.gba');
    // Outside a system folder a ROM stays, with what it looks like.
    await expect(page.locator('#lo-held')).toContainText('기종 폴더에 넣어야 옮깁니다');
    await page.locator('.lo-systems summary').click();
    await expect(page.locator('#lo-systems')).toContainText('gba 게임보이 어드밴스');
    expect(fs.existsSync(`${process.env.COOK_RETRO_DIR!}/roms/gba/Drop Quest.gba`)).toBe(true);
    await expect(page.locator('#lo-held')).toContainText('아직 복사 중인 파일입니다');
    expect(fs.existsSync(path.join(GAMES, 'Drop Game/Drop Game [0100000000020000][v0].nsp'))).toBe(true);
    expect(fs.existsSync(path.join(GAMES, 'incoming/받은 것')), 'the emptied folder goes').toBe(false);
    // What waits in the drop box is not in the library list; what moved is.
    await expect.poll(async () => (await (await page.request.get('/admin/api/library/files?q=Drop Game')).json()).matched).toBe(1);
    expect((await (await page.request.get('/admin/api/library/files?q=fresh')).json()).matched).toBe(0);
    fs.mkdirSync('out/web', { recursive: true });
    await page.locator('#tab-library').screenshot({ path: 'out/web/admin-library-incoming.png' });
  } finally {
    fs.rmSync(path.join(GAMES, 'incoming'), { recursive: true, force: true });
    fs.rmSync(path.join(GAMES, 'Drop Game'), { recursive: true, force: true });
    // Removed through the server, so its retro list forgets the game for the specs after this one,
    // and emptied from the trash it lands in, so the retro trash is empty again.
    const games = (await (await page.request.get('/api/retro/games?system=gba')).json()).games ?? [];
    for (const g of games) {
      const { trash } = await (await page.request.post('/admin/api/retro-art/games/remove', { data: { game: g.id } })).json();
      if (trash) await page.request.post('/admin/api/trash/empty', { data: { ids: [trash], confirm: 'empty' } });
    }
    fs.rmSync(`${process.env.COOK_RETRO_DIR!}/roms/gba`, { recursive: true, force: true });
  }
});
